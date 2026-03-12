import { ICommand } from '@bark/core';

export class ModelsCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && /^\/models\b/i.test(message.trim());
    }

    describe() {
        return { usage: '/models [driver]', description: 'List available models per driver', group: 'System' };
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const arg = typeof payload === 'string' ? payload.trim().replace(/^\/models\s*/i, '').trim() : '';
        const lines = [];

        if (arg) {
            // Show models for a specific driver
            const driver = registry.drivers.get(arg);
            if (!driver) {
                eventBus.publish({ type: 'command.complete', sessionId, result: `❌ Unknown driver: \`${arg}\`` });
                return;
            }
            const models = typeof driver.getModels === 'function' ? driver.getModels() : [];
            lines.push(`*${arg}* — ${models.length} model(s)`);
            for (const m of models) lines.push(`  • \`${m}\``);
        } else {
            // Show all drivers and their models
            lines.push('📋 *Available Models*', '');
            for (const [name, driver] of registry.drivers.entries()) {
                const models = typeof driver.getModels === 'function' ? driver.getModels() : [];
                lines.push(`*${name}* — ${models.length} model(s)`);
                for (const m of models) lines.push(`  • \`${m}\``);
                lines.push('');
            }
        }

        eventBus.publish({ type: 'command.complete', sessionId, result: lines.join('\n') });
    }
}
