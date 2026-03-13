import { IDriver } from '@bark/core';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { parseLine, buildProgressText } from './parser.js';

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
        this.progressCb = null;
        this.errorCb = null;
        this.completeCb = null;

        this.activeProcesses = new Map(); // sessionId -> ChildProcess
        this.killedSessions = new Set();
    }

    async spawn(config) {
        try {
            const { execSync } = await import('child_process');
            execSync('which claude', { stdio: 'ignore' });
        } catch {
            throw new Error('[ClaudeCodeDriver] The `claude` CLI is not installed or not in PATH.');
        }
    }

    getModels() {
        return ['haiku', 'sonnet', 'opus', 'claude-haiku-4-5', 'claude-sonnet-4-6', 'claude-opus-4-6'];
    }

    async sendCommand(sessionId, cmd, systemPrompt, model, driverState = {}) {
        if (this.activeProcesses.has(sessionId)) {
            if (this.errorCb) this.errorCb({ sessionId, error: new Error('Agent is already busy') });
            return;
        }

        const nativeSessionId = driverState.nativeSessionId || randomUUID();
        try {
            await this._execClaude(sessionId, nativeSessionId, cmd, true, systemPrompt, model, nativeSessionId);
        } catch (error) {
            if (error.message.includes('No conversation found')) {
                this.logger.log(`[ClaudeCodeDriver] Session not found. Initializing new session ${sessionId}...`);
                const freshUuid = randomUUID();
                await this._execClaude(sessionId, freshUuid, cmd, false, systemPrompt, model, freshUuid);
            } else {
                throw error;
            }
        }
    }

    async _execClaude(sessionId, nativeSessionId, cmd, isResume, sessionSystemPrompt, model, uuidUsed) {
        const args = [
            '--dangerously-skip-permissions',
            isResume ? '--resume' : '--session-id', nativeSessionId,
            '--model', model || this.model,
            '--output-format', 'stream-json',
            '--verbose',
            '--include-partial-messages'
        ];

        const activeSystemPrompt = sessionSystemPrompt || this.systemPrompt;
        if (activeSystemPrompt) {
            args.push(isResume ? '--append-system-prompt' : '--system-prompt');
            args.push(activeSystemPrompt);
        }

        args.push('-p', cmd);

        const child = spawn('claude', args);
        child.stdin.end();

        this.activeProcesses.set(sessionId, child);

        let finalResult = '';
        let resultError = false;
        let buffer = '';
        let errorMsg = '';
        let jsonError = null;

        // Progress state — accumulated per-session for buildProgressText
        let progressText = '';
        // Text-only accumulator (excludes thinking) for final result
        let textContent = '';
        const tools = [];

        return new Promise((resolve, reject) => {
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
                            textContent += event.text;
                            progressText += event.text;
                            if (this.progressCb) {
                                this.progressCb({ sessionId, progressText: buildProgressText(progressText, tools) });
                            }
                            break;

                        case 'thinking':
                        case 'thinking_start':
                            progressText += event.text || '';
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
                            finalResult = event.text != null && event.text !== '' ? event.text : textContent;
                            resultError = event.isError;
                            break;
                    }
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

                // Suppress callbacks if this session was force-killed
                if (this.killedSessions.has(sessionId)) {
                    this.killedSessions.delete(sessionId);
                    reject(new Error('Session killed'));
                    return;
                }

                // Flush remaining buffer
                if (buffer.trim()) {
                    const event = parseLine(buffer.trim());
                    if (event?.type === 'result') {
                        finalResult = event.text != null && event.text !== '' ? event.text : textContent;
                        resultError = event.isError;
                    }
                }

                const finalError = errorMsg || (resultError ? finalResult : '');
                if (code !== 0 || resultError) {
                    // Claude CLI exits code 1 with no output when --resume finds no session
                    const isSessionMissing = finalError.includes('No conversation found') || (isResume && code === 1 && !finalError.trim());
                    if (isSessionMissing) {
                        reject(new Error('No conversation found'));
                    } else {
                        const err = new Error(`Claude CLI exited with code ${code}: ${finalError}`);
                        if (this.errorCb) this.errorCb({ sessionId, error: err });
                        reject(err);
                    }
                } else {
                    if (this.completeCb) this.completeCb({ sessionId, result: finalResult, driverState: { nativeSessionId: uuidUsed } });
                    resolve();
                }
            });
        });
    }

    async kill(sessionId) {
        const child = this.activeProcesses.get(sessionId);
        if (child) {
            this.logger.log(`[ClaudeCodeDriver] Killing session ${sessionId}`);
            this.killedSessions.add(sessionId);
            child.kill('SIGKILL');
            this.activeProcesses.delete(sessionId);
        }
    }

    async stop() {
        this.logger.log(`[ClaudeCodeDriver] Stopping all ${this.activeProcesses.size} active sessions...`);
        for (const sessionId of Array.from(this.activeProcesses.keys())) {
            await this.kill(sessionId);
        }
    }

    onStream(cb)    { this.streamCb = cb; }
    onProgress(cb)  { this.progressCb = cb; }
    onError(cb)     { this.errorCb = cb; }
    onComplete(cb)  { this.completeCb = cb; }
}
