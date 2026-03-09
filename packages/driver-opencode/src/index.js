import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import crypto from 'crypto';

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
        this.errorCb = null;
        this.completeCb = null;
    }

    _getUuid(sessionId) {
        // Deterministic hash to map sessionId to a stable UUID for opencode's --session
        const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }

    async spawn(config = {}) {
        console.log('[OpenCodeDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null) {
        const uuid = this._getUuid(sessionId);
        const args = ['run'];

        const fullPrompt = systemPrompt 
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        // OpenCode natively supports resuming specific sessions via --session
        args.push('--session', uuid);
        args.push('--prompt', fullPrompt);

        // We run it as a standard child process capturing stdout
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

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                buffer += chunk;
                if (this.streamCb) {
                    this.streamCb({ sessionId, chunk });
                }
            });

            child.stderr.on('data', (data) => {
                errorBuffer += data.toString();
            });

            child.on('close', (code) => {
                this.activeSessions.delete(sessionId);

                if (code !== 0 && code !== null) {
                    // OpenCode might emit clean errors we want to pass up
                    console.error(`[OpenCodeDriver] Process exited with code ${code}: ${errorBuffer}`);
                    if (this.errorCb) {
                        this.errorCb({ sessionId, error: new Error(`Exit ${code}: ${errorBuffer}`) });
                    }
                    reject(new Error(`Exit ${code}`));
                    return;
                }

                if (this.completeCb) {
                    this.completeCb({ sessionId });
                }
                resolve();
            });

            child.on('error', (err) => {
                this.activeSessions.delete(sessionId);
                console.error(`[OpenCodeDriver] Spawn error:`, err);
                if (this.errorCb) {
                    this.errorCb({ sessionId, error: err });
                }
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
        for (const [sessionId, child] of this.activeSessions.entries()) {
            child.kill('SIGKILL');
        }
        this.activeSessions.clear();
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
