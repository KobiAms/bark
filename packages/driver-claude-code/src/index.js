import { IDriver } from '@bark/core';
import crypto from 'crypto';
import { spawn } from 'child_process';

export class ClaudeCodeDriver extends IDriver {
    /**
     * @param {Object} config 
     * @param {string} [config.model="sonnet"] - The Claude model to use
     * @param {string} [config.systemPrompt=""] - Optional system instructions
     */
    constructor(config = {}) {
        super();
        this.model = config.model || 'sonnet';
        this.systemPrompt = config.systemPrompt || '';
        
        this.streamCb = null;
        this.errorCb = null;
        this.completeCb = null;
        
        this.activeProcesses = new Map(); // sessionId -> ChildProcess
    }

    async spawn(config) {
        // Validation: Ensure `claude` CLI is installed
        try {
            const { execSync } = await import('child_process');
            execSync('which claude', { stdio: 'ignore' });
        } catch {
            throw new Error('[ClaudeCodeDriver] The `claude` CLI is not installed or not in PATH.');
        }
    }

    async sendCommand(sessionId, cmd, systemPrompt) {
        if (this.activeProcesses.has(sessionId)) {
            if (this.errorCb) this.errorCb({ sessionId, error: new Error('Agent is already busy') });
            return;
        }

        const validUuid = this._getUuid(sessionId);
        
        // Try to resume first
        console.log(`[ClaudeCodeDriver] Attempting to resume session ${sessionId} (UUID: ${validUuid})...`);
        try {
            await this._execClaude(sessionId, validUuid, cmd, true, systemPrompt);
        } catch (error) {
            if (error.message.includes('No conversation found')) {
                console.log(`[ClaudeCodeDriver] Session not found. Initializing new session ${sessionId}...`);
                await this._execClaude(sessionId, validUuid, cmd, false, systemPrompt);
            } else {
                throw error;
            }
        }
    }

    _getUuid(sessionId) {
        const hash = crypto.createHash('md5').update(sessionId).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    }

    async _execClaude(sessionId, uuid, cmd, isResume, sessionSystemPrompt) {
        const args = [
            '--dangerously-skip-permissions',
            isResume ? '--resume' : '--session-id', uuid,
            '--model', this.model,
            '--output-format', 'stream-json',
            '--verbose'
        ];

        const activeSystemPrompt = sessionSystemPrompt || this.systemPrompt;
        if (activeSystemPrompt) {
            args.push(isResume ? '--append-system-prompt' : '--system-prompt');
            args.push(activeSystemPrompt);
        }

        args.push('-p');
        args.push(cmd);
        
        const child = spawn('claude', args);
        child.stdin.end();

        this.activeProcesses.set(sessionId, child);

        let finalResult = '';
        let resultError = false;
        let buffer = '';
        let errorMsg = '';
        let jsonError = null;

        return new Promise((resolve, reject) => {
            child.stdout.on('data', (data) => {
                buffer += data.toString();
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';

                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith('{')) continue;

                    try {
                        const parsed = JSON.parse(trimmed);
                        if (parsed.type === 'assistant') {
                            const contents = parsed.message?.content || [];
                            for (const content of contents) {
                                if (content.type === 'text' && this.streamCb) {
                                    this.streamCb({ sessionId, chunk: content.text });
                                }
                            }
                        } else if (parsed.type === 'result') {
                            finalResult = parsed.result || '';
                            resultError = !!parsed.is_error;
                            if (resultError && parsed.errors) {
                                jsonError = parsed.errors.join(', ');
                            }
                        }
                    } catch (err) {}
                }
            });

            child.stderr.on('data', (data) => {
                errorMsg += data.toString();
            });

            child.on('error', (err) => {
                this.activeProcesses.delete(sessionId);
                reject(err);
            });

            child.on('close', (code) => {
                this.activeProcesses.delete(sessionId);

                // Flush buffer
                if (buffer.trim().startsWith('{')) {
                    try {
                        const parsed = JSON.parse(buffer.trim());
                        if (parsed.type === 'result') {
                            finalResult = parsed.result || '';
                            resultError = !!parsed.is_error;
                            if (resultError && parsed.errors) {
                                jsonError = parsed.errors.join(', ');
                            }
                        }
                    } catch (e) {}
                }

                const finalError = jsonError || errorMsg;
                if (code !== 0 || resultError) {
                    if (finalError.includes('No conversation found')) {
                        reject(new Error('No conversation found'));
                    } else {
                        const err = new Error(`Claude CLI exited with code ${code}: ${finalError}`);
                        if (this.errorCb) this.errorCb({ sessionId, error: err });
                        reject(err);
                    }
                } else {
                    if (this.completeCb) this.completeCb({ sessionId, result: finalResult });
                    resolve();
                }
            });
        });
    }

    async kill(sessionId) {
        const child = this.activeProcesses.get(sessionId);
        if (child) {
            console.log(`[ClaudeCodeDriver] Killing session ${sessionId}`);
            child.kill('SIGKILL');
            this.activeProcesses.delete(sessionId);
        }
    }

    async stop() {
        console.log(`[ClaudeCodeDriver] Stopping all ${this.activeProcesses.size} active sessions...`);
        for (const sessionId of Array.from(this.activeProcesses.keys())) {
            await this.kill(sessionId);
        }
    }

    onStream(cb) {
        this.streamCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }

    onComplete(cb) {
        this.completeCb = cb;
    }
}
