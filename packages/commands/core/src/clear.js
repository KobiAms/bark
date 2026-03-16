import { ICommand } from '@bark/core';

export class ClearCommand extends ICommand {
    match(message) {
        if (typeof message !== 'string') return false;
        const trimmed = message.trim().toLowerCase();
        return trimmed === '/clear' || trimmed.startsWith('/clear ');
    }

    describe() {
        return {
            usage: '/clear [@agent]',
            description: 'Clear session history for an agent and start fresh',
            group: 'System'
        };
    }

    async execute({ sessionId, payload, registry, targetAgentName, storage }) {
        const match = payload.match(/@(\w+)/);
        const targetAgent = match ? match[1] : targetAgentName;

        const effectiveSessionId = targetAgent ? `${targetAgent}:${sessionId}` : sessionId;

        // Kill any in-flight process
        for (const [, driver] of registry.drivers.entries()) {
            try {
                await driver.kill(effectiveSessionId);
            } catch {
                // no-op if session doesn't exist
            }
        }

        // Delete the session from storage
        if (storage?.deleteSession) {
            await storage.deleteSession(effectiveSessionId).catch(() => {});
        }

        const label = targetAgent ? `@${targetAgent}` : '@bark';
        return `🧹 ${label} session cleared — starting fresh`;
    }
}
