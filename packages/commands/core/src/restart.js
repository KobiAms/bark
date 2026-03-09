import { ICommand } from '@bark/core';

export class RestartCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.trim() === '/restart';
    }

    describe() {
        return { usage: '/restart', description: 'Restart Bark Core', group: 'System' };
    }

    async execute({ sessionId, eventBus, registry }) {
        eventBus.publish({ type: 'command.complete', sessionId, result: '🔄 Restarting Bark Core...' });
        console.log(`[RestartCommand] Restart requested by session ${sessionId}`);

        // Announce availability using the same message as startup
        setTimeout(async () => {
            const adapters = registry.getAllAdapters();
            await Promise.all(adapters.map(adapter => adapter.announce('✅ Bark Core is online!').catch(() => {})));
            process.exit(0);
        }, 1500);
    }
}
