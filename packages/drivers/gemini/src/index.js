import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { parseLine, buildProgressText } from './parser.js';

export class GeminiDriver extends IDriver {
    /**
     * @param {Object} config
     * @param {string} [config.cwd] - Working directory for the gemini CLI
     * @param {boolean} [config.yolo] - Auto-accept prompts
     */
    constructor(config = {}) {
        super();
        this.cwd = config.cwd || process.cwd();
        this.yolo = config.yolo !== undefined ? config.yolo : true;
        this.activeSessions = new Map();
        this.killedSessions = new Set();

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
        console.log('[GeminiDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null) {
        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        const args = [
            '--prompt', fullPrompt,
            '--approval-mode', 'auto_edit',
            '--output-format', 'stream-json',
        ];

        return new Promise((resolve, reject) => {
            console.log(`[GeminiDriver] Executing gemini for session ${sessionId}...`);

            const child = spawn('gemini', args, {
                cwd: this.cwd,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            this.activeSessions.set(sessionId, child);

            let buffer = '';
            let errorBuffer = '';
            let finalResult = '';

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
                        case 'text':
                            // Gemini sends full accumulated text (delta: false), emit only the new part
                            if (event.delta === false) {
                                const newPart = event.text.slice(progressText.length);
                                if (newPart && this.streamCb) this.streamCb({ sessionId, chunk: newPart });
                                textContent = event.text;
                                progressText = event.text;
                            } else {
                                if (this.streamCb) this.streamCb({ sessionId, chunk: event.text });
                                textContent += event.text;
                                progressText += event.text;
                            }
                            if (this.progressCb) {
                                this.progressCb({ sessionId, progressText: buildProgressText(progressText, tools) });
                            }
                            break;

                        case 'thinking':
                            // Gemini reasoning - accumulate into progress
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
                            // Gemini's result event often has no content — the text
                            // was already streamed via message events. Fall back to
                            // textContent (not progressText) to exclude thinking.
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
                    return;
                }

                if (code !== 0 && code !== null) {
                    console.error(`[GeminiDriver] Process exited with code ${code}: ${errorBuffer}`);
                    if (this.errorCb) this.errorCb({ sessionId, error: new Error(`Exit ${code}: ${errorBuffer}`) });
                    reject(new Error(`Exit ${code}`));
                    return;
                }

                if (this.completeCb) this.completeCb({ sessionId, result: finalResult });
                resolve();
            });

            child.on('error', (err) => {
                this.activeSessions.delete(sessionId);
                console.error(`[GeminiDriver] Spawn error:`, err);
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
        console.log(`[GeminiDriver] Stopping all ${this.activeSessions.size} active sessions...`);
        for (const child of this.activeSessions.values()) child.kill('SIGKILL');
        this.activeSessions.clear();
    }

    onStream(cb)    { this.streamCb = cb; }
    onProgress(cb)  { this.progressCb = cb; }
    onError(cb)     { this.errorCb = cb; }
    onComplete(cb)  { this.completeCb = cb; }
}
