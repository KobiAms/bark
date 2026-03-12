import { IDriver } from '@bark/core';
import { spawn, execSync } from 'child_process';
import { parseLine, buildProgressText } from './parser.js';

export class OpenCodeDriver extends IDriver {
    /**
     * @param {Object} config
     * @param {string} [config.cwd] - Working directory for the opencode CLI
     */
    constructor(config = {}) {
        super();
        this.cwd = config.cwd || process.cwd();
        this.model = config.model || 'opencode/big-pickle';
        this.activeSessions = new Map();  // barkSessionId -> ChildProcess
        this.killedSessions = new Set();

        this.streamCb = null;
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;

        this._models = null; // populated lazily at spawn time
    }

    getModels() {
        return this._models ?? [];
    }

    async spawn(config = {}) {
        try {
            const output = execSync('opencode models', { encoding: 'utf8', timeout: 10000 });
            this._models = output.split('\n').map(l => l.trim()).filter(Boolean);
        } catch {
            this._models = [];
        }
        console.log('[OpenCodeDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null, model, driverState = {}) {
        if (this.activeSessions.has(sessionId)) {
            if (this.errorCb) this.errorCb({ sessionId, error: new Error('Agent is already busy') });
            return;
        }
        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        // Build args: use --session with OpenCode's native ses_* ID if we've
        // seen this session before (for resume), otherwise start fresh.
        const activeModel = model || this.model;
        const args = ['run', '--format', 'json', '--thinking'];
        if (activeModel) {
            args.push('--model', activeModel);
        }

        const nativeSessionId = driverState.nativeSessionId;
        if (nativeSessionId) {
            args.push('--session', nativeSessionId);
        }

        // Message is a positional argument (after all flags)
        args.push(fullPrompt);

        return new Promise((resolve, reject) => {
            console.log(`[OpenCodeDriver] Executing opencode for session ${sessionId}${nativeSessionId ? ` (resume: ${nativeSessionId})` : ''}...`);

            const child = spawn('opencode', args, {
                cwd: this.cwd,
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
                            // Capture OpenCode's native session ID for future resume
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
                            // step_finish events often have no text — the actual
                            // response was already streamed via text events.
                            // Use textContent (not progressText) to exclude thinking.
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

                if (this.killedSessions.has(sessionId)) {
                    this.killedSessions.delete(sessionId);
                    reject(new Error('Session killed'));
                    return;
                }

                if (code !== 0 && code !== null) {
                    console.error(`[OpenCodeDriver] Process exited with code ${code}: ${errorBuffer}`);
                    if (this.errorCb) this.errorCb({ sessionId, error: new Error(`Exit ${code}: ${errorBuffer}`) });
                    reject(new Error(`Exit ${code}`));
                    return;
                }

                if (this.completeCb) this.completeCb({ sessionId, result: finalResult, driverState: { nativeSessionId: capturedNativeSessionId } });
                resolve();
            });

            child.on('error', (err) => {
                this.activeSessions.delete(sessionId);
                console.error(`[OpenCodeDriver] Spawn error:`, err);
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
        console.log(`[OpenCodeDriver] Stopping all ${this.activeSessions.size} active sessions...`);
        for (const child of this.activeSessions.values()) child.kill('SIGKILL');
        this.activeSessions.clear();
    }

    onStream(cb) { this.streamCb = cb; }
    onProgress(cb) { this.progressCb = cb; }
    onError(cb) { this.errorCb = cb; }
    onComplete(cb) { this.completeCb = cb; }
}
