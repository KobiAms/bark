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

    async sendCommand(sessionId, cmd) {
        if (this.activeProcesses.has(sessionId)) {
            // Already running a command. For true multi-turn, you'd wait or buffer.
            // For now, we reject concurrent commands on the same session.
            if (this.errorCb) this.errorCb({ sessionId, error: new Error('Agent is already busy') });
            return;
        }

        // Claude CLI strict requirements: session ID must be a valid UUID
        // We append Date.now() to ensure a unique UUID per execution, as the CLI throws 'Session ID already in use'
        // if we attempt to recreate an existing deterministic UUID across multiple single-turn executions.
        const claudeSessionId = crypto.createHash('md5').update(sessionId + Date.now().toString()).digest('hex');
        const validUuid = `${claudeSessionId.slice(0, 8)}-${claudeSessionId.slice(8, 12)}-4${claudeSessionId.slice(13, 16)}-a${claudeSessionId.slice(17, 20)}-${claudeSessionId.slice(20, 32)}`;

        const args = [
            '--dangerously-skip-permissions', // Needed for headless automation
            '--session-id', validUuid,
            '--model', this.model,
            '--output-format', 'stream-json',
            '--verbose'
        ];

        // If we have a system prompt, add it
        if (this.systemPrompt) {
            args.push('--system-prompt');
            args.push(this.systemPrompt);
        }

        console.log(`[ClaudeCodeDriver] Spawning claude for session ${sessionId}...`);
        
        // Push the prompt as a direct argument using '-p' instead of stdin piping
        args.push('-p');
        args.push(cmd);
        
        const child = spawn('claude', args);
        
        // Critcial: Claude might hang waiting for stdin if we don't close it explicitly
        child.stdin.end();

        this.activeProcesses.set(sessionId, child);

        let finalResult = '';
        let resultError = false;

        let buffer = '';

        child.stdout.on('data', (data) => {
            const raw = data.toString();
            // console.log(`[ClaudeCodeDriver STDOUT] ${raw.trim()}`);
            buffer += raw;
            
            // Claude's stream emits JSON objects separated by newlines, but sometimes multiple newlines or none.
            const lines = buffer.split(/\r?\n/);
            // The last line might be incomplete, keep it in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('{')) continue;

                try {
                    const parsed = JSON.parse(trimmed);
                    
                    if (parsed.type === 'assistant') {
                        // Claude Code outputs actual generation delta in an assistant event wrapper
                        const contents = parsed.message?.content || [];
                        for (const content of contents) {
                            if (content.type === 'text' && this.streamCb) {
                                this.streamCb({ sessionId, chunk: content.text });
                            }
                        }
                    } else if (parsed.type === 'result') {
                        finalResult = parsed.result || '';
                        resultError = !!parsed.is_error;
                    }
                } catch (err) {
                    // Incomplete or invalid JSON line, ignore.
                }
            }
        });

        child.stderr.on('data', (data) => {
            console.error(`[ClaudeCodeDriver STDERR] ${data.toString()}`);
        });

        child.on('error', (err) => {
            console.error(`[ClaudeCodeDriver ERROR] Failed to spawn child process:`, err);
            this.activeProcesses.delete(sessionId);
            if (this.errorCb) this.errorCb({ sessionId, error: err });
        });

        child.on('close', async (code) => {
            console.log(`[ClaudeCodeDriver] Child process closed with code ${code}`);
            this.activeProcesses.delete(sessionId);

            // Process any remaining data in buffer that didn't have a trailing newline
            if (buffer.trim().startsWith('{')) {
                try {
                    const parsed = JSON.parse(buffer.trim());
                    if (parsed.type === 'result') {
                        finalResult = parsed.result || '';
                        resultError = !!parsed.is_error;
                    }
                } catch (e) { /* ignore */ }
            }

            if (code !== 0 && resultError) {
                if (this.errorCb) this.errorCb({ sessionId, error: new Error(`Claude CLI exited with code ${code}`) });
            } else {
                if (this.completeCb) this.completeCb({ sessionId, result: finalResult });
            }
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
