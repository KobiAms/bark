import { ICommand } from '@bark/core';

export class RestartCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.trim() === '/restart';
    }

    describe() {
        return { usage: '/restart', description: 'Restart Bark Core', group: 'System' };
    }

    async execute({ sessionId, adapterName, registry, storage }) {
        const storage_ = registry.getStorage() || storage;
        const adapter = registry.getAdapter(adapterName);

        console.log(`[RestartCommand] Restart requested by session ${sessionId} via adapter ${adapterName}`);

        // Send restart message to the originating adapter and capture messageId
        if (adapter) {
            const sent = await adapter.sendMessage(sessionId, '🔄 Restarting Bark Core...').catch(() => null);

            // Store the messageId so we can edit it when the service comes back up
            if (sent?.messageId && storage_) {
                await storage_.saveSession('__restart_pending__', {
                    adapterName,
                    sessionId,
                    messageId: sent.messageId
                }).catch(() => {});
            }
        }

        setTimeout(async () => {
            console.log('[RestartCommand] Stopping all drivers and adapters before restart...');
            const drivers = registry.getAllDrivers();
            const adapters = registry.getAllAdapters();
            await Promise.all([
                ...drivers.map(d => d.stop().catch(() => {})),
                ...adapters.map(a => a.stop().catch(() => {})),
            ]);
            process.exit(0);
        }, 1500);
    }
}
