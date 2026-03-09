import { ICommand } from '@bark/core';

export class RestartCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.trim() === '/restart';
    }

    async execute({ sessionId, eventBus }) {
        const msg = '🔄 Restarting Bark Core...';
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
        
        console.log(`[RestartCommand] Restart requested by session ${sessionId}`);
        
        // Give the stream chunk 1.5 seconds to flush to the adapter/network before dying
        setTimeout(() => {
            console.log(`[RestartCommand] Executing process.exit(0) to trigger external restart...`);
            process.exit(0);
        }, 1500);
    }
}
