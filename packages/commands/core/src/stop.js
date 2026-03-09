import { ICommand } from '@bark/core';

export class StopCommand extends ICommand {
    match(message) {
        if (typeof message !== 'string') return false;
        const trimmed = message.trim().toLowerCase();
        return trimmed === '/stop' || trimmed.startsWith('/stop ');
    }

    describe() {
        return {
            usage: '/stop [agent]',
            description: 'Stop a running agent or all sessions',
            group: 'System'
        };
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const router = registry.messageRouter;
        if (!router) {
            eventBus.publish({
                type: 'command.complete',
                sessionId,
                result: '❌ Router not available'
            });
            return;
        }

        // Parse agent name if provided (e.g., "/stop @assistant")
        const match = payload.match(/@(\w+)/);
        const targetAgent = match ? match[1] : null;

        // Build effective session IDs to kill
        const sessionIdsToKill = [];
        if (targetAgent) {
            sessionIdsToKill.push(`${targetAgent}:${sessionId}`);
        } else {
            // Kill all active sessions for this user (with or without agent prefix)
            sessionIdsToKill.push(sessionId);
            // Also try to find any agent sessions for this user
            const routing = router.sessionRouting;
            for (const [key, value] of routing) {
                if (key.includes(`:${sessionId}`) || key === sessionId) {
                    if (!sessionIdsToKill.includes(key)) {
                        sessionIdsToKill.push(key);
                    }
                }
            }
        }

        // Kill all matching sessions
        const killed = [];
        for (const sid of sessionIdsToKill) {
            const routing = router.sessionRouting.get(sid);
            if (routing) {
                const storage = registry.getStorage();
                const session = await storage?.getSession(sid).catch(() => null);
                const driverName = session?.driverName;

                if (driverName) {
                    const driver = registry.getDriver(driverName);
                    if (driver) {
                        await driver.kill(sid).catch(() => {});
                        killed.push(sid);
                    }
                }
            }
        }

        // Send response
        const message = killed.length > 0
            ? `🛑 Stopped ${killed.length} session${killed.length > 1 ? 's' : ''}`
            : '⚠️ No active sessions to stop';

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
