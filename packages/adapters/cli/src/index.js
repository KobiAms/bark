import { IAdapter } from '@bark/core';
import readline from 'readline';

export class CLIAdapter extends IAdapter {
    constructor() {
        super();
        this.rl = null;
        this.messageCb = null;
        this.errorCb = null;
    }

    async start() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'Bark> '
        });

        this.rl.prompt();

        this.rl.on('line', (line) => {
            if (this.messageCb && line.trim()) {
                // Emulate a session id for CLI
                const barkEvent = {
                    type: 'message.received',
                    sessionId: 'cli-session-1',
                    payload: line.trim()
                };
                this.messageCb(barkEvent);
            } else {
                this.rl.prompt();
            }
        });

        this.logger.log('[CLIAdapter] Started.');
    }

    async stop() {
        if (this.rl) {
            this.rl.close();
        }
        this.logger.log('[CLIAdapter] Stopped.');
    }

    async sendChunk(sessionId, chunk) {
        process.stdout.write(chunk);
    }

    async sendMessage(sessionId, payload) {
        // Called when a response is fully complete — re-show the prompt
        this.logger.log();
        if (this.rl) this.rl.prompt();
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }
}
