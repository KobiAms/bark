import { ICommand } from '@bark/core';

export class SwitchDriverCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase().startsWith('/driver ');
    }

    describe() {
        return { usage: '/driver <name>', description: 'Switch AI driver for this session', group: 'Drivers' };
    }

    async execute({ sessionId, payload, registry, eventBus, storage }) {
        const parts = payload.trim().split(' ');
        const desiredDriver = parts[1];

        if (!desiredDriver) {
            const availableDrivers = Array.from(registry.drivers.keys()).join(', ');
            const msg = `Usage: /driver <name>. Available: ${availableDrivers}`;
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
            eventBus.publish({ type: 'command.complete', sessionId, result: msg });
            return;
        }

        if (!registry.getDriver(desiredDriver)) {
            const msg = `[System] Error: Driver '${desiredDriver}' is not registered.`;
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg + '\n' });
            eventBus.publish({ type: 'command.complete', sessionId, result: msg });
            return;
        }

        let session = await storage.getSession(sessionId);
        if (!session) {
            session = { sessionId, driverName: desiredDriver };
        } else {
            session.driverName = desiredDriver;
        }
        await storage.saveSession(sessionId, session);

        const msg = `[System] Switched to driver: ${desiredDriver}`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg + '\n' });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}
