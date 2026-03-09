import { ICommand } from '@bark/core';

export class RestartCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.trim() === '/restart';
    }

    async execute({ sessionId, eventBus }) {
        eventBus.publish({ type: 'command.complete', sessionId, result: '🔄 Restarting Bark Core...' });
        console.log(`[RestartCommand] Restart requested by session ${sessionId}`);

        // Give adapters time to flush the message before the process exits.
        // The process manager (pm2 / start.sh) is responsible for restarting.
        // On startup, LifecycleManager.announce() will notify all adapters.
        setTimeout(() => process.exit(0), 1500);
    }
}
