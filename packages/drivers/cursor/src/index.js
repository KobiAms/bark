import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import { parseLine, buildProgressText } from './parser.js';

export class CursorDriver extends IDriver {
    /**
     * @param {Object} config
     * @param {string} [config.model] - The model to use (e.g. "sonnet-4.5-thinking")
     * @param {string} [config.workspace] - Working directory / workspace path
     * @param {string} [config.mode] - Agent mode: "agent" (default), "plan", or "ask"
     */
    constructor(config = {}) {
        super();
        this.model = config.model || null;
        this.workspace = config.workspace || process.cwd();
        this.mode = config.mode || 'agent';

        this.activeSessions = new Map();  // barkSessionId -> ChildProcess
        this.killedSessions = new Set();

        this.streamCb = null;
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;

        this._models = null;
    }

    getModels() {
        return this._models ?? [];
    }

    async spawn(config = {}) {
        try {
            const { execSync } = await import('child_process');
            // `agent models` outputs lines like "model-id - Display Name"
            // with ANSI escape codes for the spinner/progress
            const raw = execSync('agent models', { encoding: 'utf8', timeout: 10000 });
            // Strip ANSI escape sequences, then extract model ids from "id - name" lines
            const clean = raw.replace(/\x1b\[[0-9;]*[A-Za-z]|\x1b\[[?0-9;]*[A-Za-z]/g, '');
            this._models = clean.split('\n')
                .map(l => l.trim())
                .filter(l => l.includes(' - '))
                .map(l => l.split(' - ')[0].trim().replace(/\(current\)/, '').trim())
                .filter(Boolean);
        } catch (err) {
            console.warn('[CursorDriver] Failed to fetch models from `agent models` CLI:', err.message);
            this._models = ['sonnet-4.5-thinking', 'sonnet-4-20250514', 'claude-opus-4-1', 'claude-opus-4-20250805'];
        }
        console.log('[CursorDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null, model, driverState = {}) {
        if (this.activeSessions.has(sessionId)) {
            if (this.errorCb) this.errorCb({ sessionId, error: new Error('Agent is already busy') });
            return;
        }

        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        const activeModel = model || this.model;
        const args = [
            '-p', fullPrompt,
            '--output-format', 'stream-json',
            '--force',
            '--trust',
            '--workspace', this.workspace,
        ];

        if (activeModel) {
            args.push('--model', activeModel);
        }

        if (this.mode && this.mode !== 'agent') {
            args.push('--mode', this.mode);
        }

        // Resume existing session if we have one
        const nativeSessionId = driverState.nativeSessionId;
        if (nativeSessionId) {
            args.push('--resume', nativeSessionId);
        }

        return new Promise((resolve, reject) => {
            console.log(`[CursorDriver] Executing agent for session ${sessionId}${nativeSessionId ? ` (resume: ${nativeSessionId})` : ''}...`);

            const child = spawn('agent', args, {
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.activeSessions.set(sessionId, child);

            let buffer = '';
            let errorBuffer = '';
            let finalResult = '';
            let capturedNativeSessionId = nativeSessionId; // Track the native ID from init event

            // Progress state (thinking + text, for live updates)
            let progressText = '';
            // Text-only accumulator (for final result)
            let textContent = '';
            const tools = [];

            child.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const event = parseLine(line);
                    if (!event) continue;

                    switch (event.type) {
                        case 'init':
                            // Capture Cursor's native session ID for future resume
                            if (event.sessionId) {
                                capturedNativeSessionId = event.sessionId;
                            }
                            break;

                        case 'text':
                            if (this.streamCb) this.streamCb({ sessionId, chunk: event.text });
                            textContent += event.text;
                            progressText += event.text;
                            if (this.progressCb) {
                                this.progressCb({ sessionId, progressText: buildProgressText(progressText, tools) });
                            }
                            break;

                        case 'thinking':
                            progressText += event.text;
                            if (this.progressCb) {
                                this.progressCb({ sessionId, progressText: buildProgressText(progressText, tools) });
                            }
                            break;

                        case 'tool':
                            tools.push({ icon: event.icon, name: event.name });
                            if (this.progressCb) {
                                this.progressCb({ sessionId, progressText: buildProgressText(progressText, tools) });
                            }
                            break;

                        case 'result':
                            // Use textContent (not progressText) to exclude thinking from final result
                            finalResult = event.text || textContent;
                            break;
                    }
                }
            });

            child.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });

            child.on('close', (code) => {
                this.activeSessions.delete(sessionId);

                // Suppress callbacks if this session was force-killed
                if (this.killedSessions.has(sessionId)) {
                    this.killedSessions.delete(sessionId);
                    reject(new Error('Session killed'));
                    return;
                }

                if (code !== 0 && code !== null) {
                    console.error(`[CursorDriver] Process exited with code ${code}: ${errorBuffer}`);
                    if (this.errorCb) this.errorCb({ sessionId, error: new Error(`Exit ${code}: ${errorBuffer}`) });
                    reject(new Error(`Exit ${code}`));
                    return;
                }

                if (this.completeCb) this.completeCb({ sessionId, result: finalResult, driverState: { nativeSessionId: capturedNativeSessionId } });
                resolve();
            });

            child.on('error', (err) => {
                this.activeSessions.delete(sessionId);
                console.error(`[CursorDriver] Spawn error:`, err);
                if (this.errorCb) this.errorCb({ sessionId, error: err });
                reject(err);
            });
        });
    }

    async kill(sessionId) {
        const child = this.activeSessions.get(sessionId);
        if (child) {
            this.killedSessions.add(sessionId);
            child.kill('SIGKILL');
            this.activeSessions.delete(sessionId);
        }
    }

    async stop() {
        console.log(`[CursorDriver] Stopping all ${this.activeSessions.size} active sessions...`);
        for (const child of this.activeSessions.values()) child.kill('SIGKILL');
        this.activeSessions.clear();
    }

    onStream(cb) { this.streamCb = cb; }
    onProgress(cb) { this.progressCb = cb; }
    onError(cb) { this.errorCb = cb; }
    onComplete(cb) { this.completeCb = cb; }
}
