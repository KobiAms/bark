import { ICommand } from '@bark/core';

export class HelpCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.trim().toLowerCase() === '/help';
    }

    describe() {
        return { usage: '/help', description: 'Show this message', group: 'System' };
    }

    async execute({ sessionId, registry, storage, eventBus }) {
        // Resolve active driver for this session
        let activeDriver = null;
        if (storage) {
            const session = await storage.getSession(sessionId);
            activeDriver = session?.driverName || null;
        }
        if (!activeDriver) {
            activeDriver = Array.from(registry.drivers.keys())[0] || 'none';
        }

        // Collect command metadata from all registered commands
        const groups = new Map();
        for (const command of registry.getAllCommands()) {
            const info = command.describe?.();
            if (!info) continue;
            const group = info.group || 'Other';
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(info);
        }

        const lines = ['🐕 *Bark Commands*', ''];

        for (const [group, commands] of groups) {
            lines.push(`*${group}*`);
            for (const cmd of commands) {
                lines.push(`\`${cmd.usage}\` — ${cmd.description}`);
            }
            lines.push('');
        }

        // Messaging is core routing behavior, not a command — always shown
        lines.push('*Messaging*');
        lines.push('`@<name> <message>` — Talk to an agent');
        lines.push('_(reply to an agent message)_ — Continue conversation');
        lines.push('');

        // Dynamic driver info
        const drivers = Array.from(registry.drivers.keys()).join(', ');
        lines.push(`Available drivers: ${drivers}`);
        lines.push(`Active driver: *${activeDriver}*`);

        eventBus.publish({ type: 'command.complete', sessionId, result: lines.join('\n') });
    }
}
