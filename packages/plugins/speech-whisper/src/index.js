import { IPlugin, EventTypes } from '@bark/core';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

/**
 * WhisperPlugin
 *
 * Subscribes to 'message.received' events. If the payload is an audio object
 * ({ type: 'audio', filePath }), transcribes it to text via whisper.cpp and
 * re-publishes as 'message.received.text'. Plain text payloads are passed through.
 *
 * Requires:
 *   - whisper-cli  (whisper.cpp CLI binary, in PATH or configured via whisperBin)
 *   - ffmpeg       (for audio format conversion, in PATH or configured via ffmpegBin)
 *
 * Usage:
 *   bark.usePlugin(new WhisperPlugin({ modelPath: '/path/to/model.gguf' }));
 */
export class WhisperPlugin extends IPlugin {
    /**
     * @param {Object} config
     * @param {string} config.modelPath   - Absolute path to the .gguf model file
     * @param {string} [config.whisperBin='whisper-cli'] - Path or name of the whisper-cli binary
     * @param {string} [config.ffmpegBin='ffmpeg']       - Path or name of the ffmpeg binary
     */
    constructor({ modelPath, whisperBin = 'whisper-cli', ffmpegBin = 'ffmpeg' } = {}) {
        super();
        if (!modelPath) throw new Error('[WhisperPlugin] config.modelPath is required');
        this.modelPath = modelPath;
        this.whisperBin = whisperBin;
        this.ffmpegBin = ffmpegBin;
        this._unsub = null;
    }

    get inputEvent()  { return EventTypes.MESSAGE_RECEIVED; }
    get outputEvent() { return EventTypes.MESSAGE_RECEIVED_TEXT; }

    register(eventBus) {
        this._unsub = eventBus.subscribe(this.inputEvent, async (event) => {
            try {
                const text = await this._toText(event.payload);
                eventBus.publish({ ...event, type: this.outputEvent, payload: text });
            } catch (err) {
                this.logger.error('[WhisperPlugin] Transcription failed:', err.message);
                // Forward the event so the pipeline never stalls
                const fallback = typeof event.payload === 'string'
                    ? event.payload
                    : '[audio transcription failed]';
                eventBus.publish({ ...event, type: this.outputEvent, payload: fallback });
            }
        });
        this.logger.log('[WhisperPlugin] Registered — listening for audio payloads.');
    }

    async stop() {
        if (this._unsub) {
            this._unsub();
            this._unsub = null;
        }
    }

    /**
     * Resolve a payload to a plain text string.
     * @param {string|{type:'audio', filePath:string}} payload
     * @returns {Promise<string>}
     */
    async _toText(payload) {
        if (typeof payload === 'string') return payload;

        if (payload?.type === 'audio' && payload.filePath) {
            return this._transcribe(payload.filePath);
        }

        throw new Error(`[WhisperPlugin] Unrecognised payload shape: ${JSON.stringify(payload)}`);
    }

    /**
     * Convert audio file to text via ffmpeg + whisper-cli.
     * @param {string} inputPath
     * @returns {Promise<string>}
     */
    async _transcribe(inputPath) {
        const workDir = mkdtempSync(join(tmpdir(), 'bark-whisper-'));
        const wavPath = join(workDir, 'audio.wav');

        try {
            // Normalise to 16 kHz mono WAV — whisper.cpp requirement
            await execFileAsync(this.ffmpegBin, [
                '-i', inputPath,
                '-ar', '16000',
                '-ac', '1',
                '-c:a', 'pcm_s16le',
                '-y', wavPath
            ]);

            // -otxt  → write transcript to wavPath.txt
            // -np    → suppress progress prints
            // -nt    → no timestamps in transcript
            await execFileAsync(this.whisperBin, [
                '-m', this.modelPath,
                '-f', wavPath,
                '-otxt',
                '-np',
                '-nt',
            ]);

            const txtPath = `${wavPath}.txt`;
            if (!existsSync(txtPath)) {
                throw new Error('whisper-cli did not produce an output file');
            }

            return readFileSync(txtPath, 'utf8').trim();
        } finally {
            try { rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}
