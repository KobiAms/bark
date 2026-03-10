import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import { parseLine, buildProgressText } from './parser.js';

export class OpenCodeDriver extends IDriver {
    /**
     * @param {Object} config
     * @param {string} [config.cwd] - Working directory for the opencode CLI
     */
    constructor(config = {}) {
        super();
        this.cwd = config.cwd || process.cwd();
        this.activeSessions = new Map();  // barkSessionId -> ChildProcess
        this.killedSessions = new Set();

        // Maps Bark sessionIds to OpenCode's native `ses_*` IDs for session resume
        this.sessionIdMap = new Map();

        this.streamCb = null;
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;
    }

    async spawn(config = {}) {
        console.log('[OpenCodeDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null) {
        const fullPrompt = systemPrompt
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        // Build args: use --session with OpenCode's native ses_* ID if we've
        // seen this session before (for resume), otherwise start fresh.
        const args = ['run', '--format', 'json', '--thinking'];

        const nativeSessionId = this.sessionIdMap.get(sessionId);
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
                                this.sessionIdMap.set(sessionId, event.sessionId);
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
                    return;
                }

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

    onStream(cb)    { this.streamCb = cb; }
    onProgress(cb)  { this.progressCb = cb; }
    onError(cb)     { this.errorCb = cb; }
    onComplete(cb)  { this.completeCb = cb; }
}
