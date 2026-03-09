import { ICommand } from '@bark/core';

export class CompactCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase() === '/compact';
    }

    describe() {
        return {
            usage: '/compact',
            description: 'Compact storage files (remove deleted entries)',
            group: 'System'
        };
    }

    async execute({ sessionId, registry, eventBus }) {
        const storage = registry.getStorage();
        const agentRegistry = registry.getAgentRegistry();

        let compacted = 0;

        if (storage?.compact) {
            try {
                await storage.compact();
                compacted++;
            } catch (e) {
                console.error('[CompactCommand] Failed to compact storage:', e);
            }
        }

        if (agentRegistry?.compact) {
            try {
                await agentRegistry.compact();
                compacted++;
            } catch (e) {
                console.error('[CompactCommand] Failed to compact agent registry:', e);
            }
        }

        const message = compacted > 0
            ? `🧹 Compacted ${compacted} file${compacted > 1 ? 's' : ''}`
            : '⚠️ No storage to compact';

        eventBus.publish({
            type: 'stream.chunk',
            sessionId,
            chunk: message
        });
        eventBus.publish({
            type: 'command.complete',
            sessionId,
            result: message
        });
    }
}
