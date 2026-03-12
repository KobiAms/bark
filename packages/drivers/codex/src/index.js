import { realpathSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { IDriver } from '@bark/core';
import { buildProgressText, parseLine } from './parser.js';

export class CodexDriver extends IDriver {
    constructor(config = {}) {
        super();
        this.cwd = config.cwd || process.cwd();
        this.binary = config.binary || null;
        this.model = config.model || null;
        this.skipPermissions = config.skipPermissions !== undefined ? config.skipPermissions : true;

        this.activeSessions = new Map();
        this.killedSessions = new Set();
        this.sessionThreads = new Map();

        this.streamCb = null;
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;

        this._models = [
            'gpt-5.4', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2',
            'gpt-5.1-codex-max', 'gpt-5.1-codex', 'gpt-5-codex',
            'gpt-5.1-codex-mini', 'gpt-5-codex-mini',
        ];
    }

    getModels() {
        return this._models;
    }

    async spawn() {
        try {
            this.binary = this.binary || this._resolveBinary();
        } catch {
            throw new Error('[CodexDriver] The `codex` CLI is not installed or not in PATH.');
        }
    }

    _resolveBinary() {
        const candidates = execSync('which -a codex', { encoding: 'utf8', timeout: 10000 })
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (candidates.length === 0) {
            throw new Error('codex not found');
        }

        for (const candidate of candidates) {
            try {
                const resolved = realpathSync(candidate);
                if (!resolved.endsWith('.js')) {
                    return candidate;
                }
            } catch {
                // Ignore broken candidates and continue.
            }
        }

        return candidates[0];
    }

    async sendCommand(sessionId, prompt, systemPrompt = null, model, driverState = {}) {
        if (this.activeSessions.has(sessionId)) {
            const error = new Error('Agent is already busy');
            if (this.errorCb) this.errorCb({ sessionId, error });
            return;
        }

        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        const activeModel = model || this.model;
        const nativeSessionId = driverState.nativeSessionId || this.sessionThreads.get(sessionId);
        const args = nativeSessionId
            ? ['exec', 'resume', nativeSessionId, '--json']
            : ['exec', '--json'];

        if (this.skipPermissions) {
            args.push('--dangerously-bypass-approvals-and-sandbox');
        }

        if (activeModel) {
            args.push('-m', activeModel);
        }

        args.push('-');

        return new Promise((resolve, reject) => {
            console.log(`[CodexDriver] Executing codex for session ${sessionId}${nativeSessionId ? ` (resume: ${nativeSessionId})` : ''}...`);

            const child = spawn(this.binary || 'codex', args, {
                cwd: this.cwd,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            this.activeSessions.set(sessionId, child);

            let buffer = '';
            let errorBuffer = '';
            let finalResult = '';
            let capturedNativeSessionId = nativeSessionId;
            let progressText = '';
            let textContent = '';
            const tools = [];

            if (this.progressCb) {
                this.progressCb({ sessionId, progressText: '_thinking..._' });
            }

            child.stdin.write(fullPrompt);
            child.stdin.end();

            child.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const event = parseLine(line);
                    if (!event) continue;

                    switch (event.type) {
                        case 'init':
                            if (event.sessionId) {
                                capturedNativeSessionId = event.sessionId;
                                this.sessionThreads.set(sessionId, event.sessionId);
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

                if (buffer.trim()) {
                    const event = parseLine(buffer.trim());
                    if (event?.type === 'result') {
                        finalResult = event.text || textContent;
                    } else if (event?.type === 'text') {
                        textContent += event.text;
                        finalResult = textContent;
                    }
                }

                if (code !== 0 && code !== null) {
                    const error = new Error(`Exit ${code}: ${errorBuffer}`);
                    if (this.errorCb) this.errorCb({ sessionId, error });
                    reject(error);
                    return;
                }

                if (this.completeCb) {
                    if (capturedNativeSessionId) {
                        this.sessionThreads.set(sessionId, capturedNativeSessionId);
                    }
                    this.completeCb({ sessionId, result: finalResult, driverState: { nativeSessionId: capturedNativeSessionId } });
                }
                resolve();
            });

            child.on('error', (err) => {
                this.activeSessions.delete(sessionId);
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
        this.sessionThreads.delete(sessionId);
    }

    async stop() {
        console.log(`[CodexDriver] Stopping all ${this.activeSessions.size} active sessions...`);
        for (const child of this.activeSessions.values()) child.kill('SIGKILL');
        this.activeSessions.clear();
        this.sessionThreads.clear();
    }

    onStream(cb) { this.streamCb = cb; }
    onProgress(cb) { this.progressCb = cb; }
    onError(cb) { this.errorCb = cb; }
    onComplete(cb) { this.completeCb = cb; }
}
