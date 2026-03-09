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

        console.log('[CLIAdapter] Started.');
    }

    async stop() {
        if (this.rl) {
            this.rl.close();
        }
        console.log('[CLIAdapter] Stopped.');
    }

    async sendMessage(sessionId, payload) {
        // Output the stream chunk without newlines
        process.stdout.write(payload);
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }
}
