import { IDriver } from '@bark/core';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

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
        
        // Ensure .bark-tmp exists for session state tracking (similar to ClaudeCodeDriver)
        this.tmpDir = path.resolve(this.cwd, '.bark-tmp');
        if (!fs.existsSync(this.tmpDir)) {
            fs.mkdirSync(this.tmpDir, { recursive: true });
        }
        
        this.activeSessions = new Map();
        
        this.streamCb = null;
        this.errorCb = null;
        this.completeCb = null;
    }

    _getUuid(sessionId) {
        // Deterministic hash to map sessionId to a stable UUID for resuming
        const hash = crypto.createHash('sha256').update(sessionId).digest('hex');
        return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
    }

    _getSessionFile(uuid) {
        return path.join(this.tmpDir, `gemini_session_${uuid}.json`);
    }

    async spawn(config = {}) {
        console.log('[GeminiDriver] Ready to spawn sessions on demand.');
    }

    async sendCommand(sessionId, prompt, systemPrompt = null) {
        const uuid = this._getUuid(sessionId);
        const sessionFile = this._getSessionFile(uuid);
        const hasExistingSession = fs.existsSync(sessionFile);

        const args = [];
        
        // Append system prompt if it exists (Gemini doesn't have an explicit system prompt flag, 
        // so we prepend it to the user's prompt as context).
        const fullPrompt = systemPrompt 
            ? `[SYSTEM CONTEXT: ${systemPrompt}]\n\nUser Request: ${prompt}`
            : prompt;

        args.push('--prompt', fullPrompt);
        args.push('--approval-mode', 'auto_edit'); // Auto-approve edits for seamless agent tooling
        args.push('--output-format', 'text');

        // Gemini CLI doesn't support resuming by explicitly injected UUIDs, only by its internal sqlite indices
        // e.g. `--resume 5`. This makes multi-agent thread resuming highly unstable.
        // For V1, GeminiDriver runs statelessly.

        return new Promise((resolve, reject) => {
            console.log(`[GeminiDriver] Executing gemini...`);
            
            const child = spawn('gemini', args, {
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
                
                // Save a marker that this session ran
                fs.writeFileSync(sessionFile, JSON.stringify({ lastRun: Date.now() }));

                if (code !== 0 && code !== null) {
                    console.error(`[GeminiDriver] Process exited with code ${code}: ${errorBuffer}`);
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
                console.error(`[GeminiDriver] Spawn error:`, err);
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
        console.log(`[GeminiDriver] Stopping all ${this.activeSessions.size} active sessions...`);
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
