import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { parseLine, buildProgressText } from './parser.js';

export class OpenCodeDriver extends IDriver {
    /**
     * @param {Object} config
     * @param {string} [config.cwd] - Working directory for the opencode CLI
     */
    constructor(config = {}) {
        super();
        this.cwd = config.cwd || process.cwd();
        this.activeSessions = new Map();

        this.streamCb = null;
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;
    }

    _getUuid(sessionId) {
        const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }

    async spawn(config = {}) {
        console.log('[OpenCodeDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null) {
        const uuid = this._getUuid(sessionId);

        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        const args = ['run', '--session', uuid, '--format', 'json', '--prompt', fullPrompt];

        return new Promise((resolve, reject) => {
            console.log(`[OpenCodeDriver] Executing opencode for session ${uuid}...`);

            const child = spawn('opencode', args, {
                cwd: this.cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.activeSessions.set(sessionId, child);

            let buffer = '';
            let errorBuffer = '';
            let finalResult = '';

            // Progress state
            let progressText = '';
            const tools = [];

            child.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const event = parseLine(line);
                    if (!event) continue;

                    switch (event.type) {
                        case 'text':
                            if (this.streamCb) this.streamCb({ sessionId, chunk: event.text });
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
                            if (event.text) finalResult = event.text;
                            break;
                    }
                }
            });

            child.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });

            child.on('close', (code) => {
                this.activeSessions.delete(sessionId);

                if (code !== 0 && code !== null) {
                    console.error(`[OpenCodeDriver] Process exited with code ${code}: ${errorBuffer}`);
                    if (this.errorCb) this.errorCb({ sessionId, error: new Error(`Exit ${code}: ${errorBuffer}`) });
                    reject(new Error(`Exit ${code}`));
                    return;
                }

                if (this.completeCb) this.completeCb({ sessionId, result: finalResult });
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
            child.kill('SIGKILL');
            this.activeSessions.delete(sessionId);
        }
    }

    async stop() {
        console.log(`[OpenCodeDriver] Stopping all ${this.activeSessions.size} active sessions...`);
        for (const child of this.activeSessions.values()) child.kill('SIGKILL');
        this.activeSessions.clear();
    }

    onStream(cb)    { this.streamCb = cb; }
    onProgress(cb)  { this.progressCb = cb; }
    onError(cb)     { this.errorCb = cb; }
    onComplete(cb)  { this.completeCb = cb; }
}
