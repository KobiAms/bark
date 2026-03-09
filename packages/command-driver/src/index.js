import { ICommand } from '@bark/core';

export class SwitchDriverCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase().startsWith('/driver ');
    }

    async execute({ sessionId, payload, registry, eventBus, storage }) {
        const parts = payload.trim().split(' ');
        const desiredDriver = parts[1];

        // Ensure driver exists
        if (!registry.getDriver(desiredDriver)) {
            eventBus.publish({
                type: 'stream.chunk',
                sessionId,
                chunk: `[System] Error: Driver '${desiredDriver}' is not registered.\n`
            });
            eventBus.publish({
                type: 'command.complete',
                sessionId,
                result: `[System] Error: Driver '${desiredDriver}' is not registered.`
            });
            return;
        }

        // Update the session in storage to point to the new driver
        let session = await storage.getSession(sessionId);
        if (!session) {
            session = { sessionId, driverName: desiredDriver };
        } else {
            session.driverName = desiredDriver;
        }
        await storage.saveSession(sessionId, session);

        // Notify user
        eventBus.publish({
            type: 'stream.chunk',
            sessionId,
            chunk: `[System] Switched to driver: ${desiredDriver}\n`
        });
        
        eventBus.publish({
            type: 'command.complete',
            sessionId,
            result: `[System] Switched to driver: ${desiredDriver}`
        });
    }
}
