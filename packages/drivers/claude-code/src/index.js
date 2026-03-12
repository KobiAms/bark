import { IDriver } from '@bark/core';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseLine, buildProgressText } from './parser.js';

// Test file generators
function generateTestImage() {
    const filename = `test-${Date.now()}.png`;
    const filepath = join(mkdtempSync(join(tmpdir(), 'bark-test-')), filename);
    const pngHeader = Buffer.from([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C,
        0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x02,
        0x00, 0x01, 0x49, 0xB4, 0xE8, 0xB7, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ]);
    writeFileSync(filepath, pngHeader);
    return { filePath: filepath, mimeType: 'image/png', fileName: filename, caption: '🎨 Test image!' };
}

function generateTestPdf() {
    const filename = `test-${Date.now()}.txt`;
    const filepath = join(mkdtempSync(join(tmpdir(), 'bark-test-')), filename);
    const content = `Test File from Bark\n===================\n\nGenerated at: ${new Date().toISOString()}\n\nThis demonstrates the FILE_READY event pipeline!\n`;
    writeFileSync(filepath, content, 'utf8');
    return { filePath: filepath, mimeType: 'text/plain', fileName: filename, caption: '📄 Test document!' };
}

function generateTestChart() {
    const filename = `chart-${Date.now()}.txt`;
    const filepath = join(mkdtempSync(join(tmpdir(), 'bark-test-')), filename);
    const chart = `Performance Metrics\n===================\n\nSystem Load:  ████████░░ 80%\nMemory:       ██████░░░░ 60%\nDisk I/O:     ███████░░░ 70%\nNetwork:      ██████████ 100%\n`;
    writeFileSync(filepath, chart, 'utf8');
    return { filePath: filepath, mimeType: 'text/plain', fileName: filename, caption: '📊 Performance chart!' };
}

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
        this.fileReadyCb = null;

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
        return ['haiku', 'sonnet', 'opus'];
    }

    async sendCommand(sessionId, cmd, systemPrompt, model, driverState = {}) {
        const cmdTrimmed = cmd.trim().toLowerCase();

        // Test commands for file delivery demo
        if (cmdTrimmed === 'send image' || cmdTrimmed === 'send file') {
            try {
                this.logger.log('[ClaudeCodeDriver] TEST: Generating test image...');
                const fileData = generateTestImage();
                this.logger.log(`[ClaudeCodeDriver] TEST: Image generated at ${fileData.filePath}`);

                if (!this.fileReadyCb) {
                    this.logger.error('[ClaudeCodeDriver] ERROR: fileReadyCb is not registered!');
                    if (this.completeCb) {
                        this.completeCb({ sessionId, result: '❌ File callback not registered' });
                    }
                    return;
                }

                this.logger.log('[ClaudeCodeDriver] TEST: Emitting FILE_READY event...');
                this.fileReadyCb({ sessionId, ...fileData });
                this.logger.log('[ClaudeCodeDriver] TEST: FILE_READY emitted successfully');

                if (this.completeCb) {
                    this.completeCb({ sessionId, result: 'Image generated and sent! 🖼️' });
                }
            } catch (err) {
                this.logger.error('[ClaudeCodeDriver] ERROR generating image:', err);
                if (this.completeCb) {
                    this.completeCb({ sessionId, result: `❌ Error: ${err.message}` });
                }
            }
            return;
        }

        if (cmdTrimmed === 'send chart') {
            try {
                this.logger.log('[ClaudeCodeDriver] TEST: Generating test chart...');
                const fileData = generateTestChart();
                this.logger.log(`[ClaudeCodeDriver] TEST: Chart generated at ${fileData.filePath}`);

                if (!this.fileReadyCb) {
                    this.logger.error('[ClaudeCodeDriver] ERROR: fileReadyCb is not registered!');
                    if (this.completeCb) {
                        this.completeCb({ sessionId, result: '❌ File callback not registered' });
                    }
                    return;
                }

                this.logger.log('[ClaudeCodeDriver] TEST: Emitting FILE_READY event...');
                this.fileReadyCb({ sessionId, ...fileData });
                this.logger.log('[ClaudeCodeDriver] TEST: FILE_READY emitted successfully');

                if (this.completeCb) {
                    this.completeCb({ sessionId, result: 'Chart generated and sent! 📊' });
                }
            } catch (err) {
                this.logger.error('[ClaudeCodeDriver] ERROR generating chart:', err);
                if (this.completeCb) {
                    this.completeCb({ sessionId, result: `❌ Error: ${err.message}` });
                }
            }
            return;
        }

        if (cmdTrimmed === 'send document') {
            try {
                this.logger.log('[ClaudeCodeDriver] TEST: Generating test document...');
                const fileData = generateTestPdf();
                this.logger.log(`[ClaudeCodeDriver] TEST: Document generated at ${fileData.filePath}`);

                if (!this.fileReadyCb) {
                    this.logger.error('[ClaudeCodeDriver] ERROR: fileReadyCb is not registered!');
                    if (this.completeCb) {
                        this.completeCb({ sessionId, result: '❌ File callback not registered' });
                    }
                    return;
                }

                this.logger.log('[ClaudeCodeDriver] TEST: Emitting FILE_READY event...');
                this.fileReadyCb({ sessionId, ...fileData });
                this.logger.log('[ClaudeCodeDriver] TEST: FILE_READY emitted successfully');

                if (this.completeCb) {
                    this.completeCb({ sessionId, result: 'Document generated and sent! 📄' });
                }
            } catch (err) {
                this.logger.error('[ClaudeCodeDriver] ERROR generating document:', err);
                if (this.completeCb) {
                    this.completeCb({ sessionId, result: `❌ Error: ${err.message}` });
                }
            }
            return;
        }

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
            '--verbose'
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
                            finalResult = event.text;
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
                        finalResult = event.text;
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

    onStream(cb)     { this.streamCb = cb; }
    onProgress(cb)   { this.progressCb = cb; }
    onError(cb)      { this.errorCb = cb; }
    onComplete(cb)   { this.completeCb = cb; }
    onFileReady(cb)  { this.fileReadyCb = cb; }
}
