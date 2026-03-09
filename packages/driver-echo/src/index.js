import { IDriver } from '@bark/core';

export class EchoDriver extends IDriver {
    constructor() {
        super();
        this.streamCb = null;
        this.errorCb = null;
        this.completeCb = null;
        this.activeIntervals = new Map(); // sessionId -> NodeJS.Timeout
    }

    async spawn(config) {
        console.log('[EchoDriver] Spawned with config:', config);
    }

    async sendCommand(sessionId, cmd) {
        if (!this.streamCb) return;

        // Simulate streaming response
        const words = `[Echoed from Driver]: ${cmd}`.split(' ');
        let i = 0;

        const intervalId = setInterval(() => {
            if (i < words.length) {
                this.streamCb({
                    sessionId,
                    chunk: words[i] + ' '
                });
                i++;
            } else {
                clearInterval(intervalId);
                this.activeIntervals.delete(sessionId);
                if (this.completeCb) {
                    this.completeCb({ sessionId, result: `[Echoed from Driver]: ${cmd}` });
                }
            }
        }, 300); // Slower for effect
        
        this.activeIntervals.set(sessionId, intervalId);
    }

    async kill(sessionId) {
        console.log(`[EchoDriver] Killed session ${sessionId}`);
        const intervalId = this.activeIntervals.get(sessionId);
        if (intervalId) {
            clearInterval(intervalId);
            this.activeIntervals.delete(sessionId);
        }
    }

    async stop() {
        console.log(`[EchoDriver] Stopping all ${this.activeIntervals.size} active sessions...`);
        for (const sessionId of Array.from(this.activeIntervals.keys())) {
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
