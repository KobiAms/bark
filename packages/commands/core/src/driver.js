import { ICommand } from '@bark/core';

export class SwitchDriverCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase().startsWith('/driver ');
    }

    describe() {
        return { usage: '/driver <name>', description: 'Switch AI driver for this session', group: 'Drivers' };
    }

    async execute({ sessionId, payload, registry, storage }) {
        const parts = payload.trim().split(' ');
        const desiredDriver = parts[1];

        if (!desiredDriver) {
            const availableDrivers = Array.from(registry.drivers.keys()).join(', ');
            return `Usage: /driver <name>. Available: ${availableDrivers}`;
        }

        if (!registry.getDriver(desiredDriver)) {
            return `[System] Error: Driver '${desiredDriver}' is not registered.`;
        }

        let session = await storage.getSession(sessionId);
        if (!session) {
            session = { sessionId, driverName: desiredDriver };
        } else {
            session.driverName = desiredDriver;
        }
        await storage.saveSession(sessionId, session);

        return `[System] Switched to driver: ${desiredDriver}`;
    }
}
