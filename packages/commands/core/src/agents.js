import { ICommand } from '@bark/core';

export class NewCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/new');
    }

    describe() {
        return { usage: '/new <name> [<driver>] [--model <m>] [--prompt <p>]', description: 'Create a new agent', group: 'Agents' };
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const parts = payload.split(' ');
        const name = parts[1];

        if (!name || name.startsWith('--')) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: '❌ Usage: /new <name> [<driver>] [--model <model>] [--prompt <prompt>]' });
            return;
        }

        // Support both positional (/new <name> <driver>) and flag (/new <name> --driver <d>)
        const driverMatch = payload.match(/--driver\s+(\S+)/);
        const positionalDriver = parts[2] && !parts[2].startsWith('--') ? parts[2] : null;
        const driver = driverMatch ? driverMatch[1].trim() : (positionalDriver || Array.from(registry.drivers.keys())[0] || 'claude');

        const modelMatch = payload.match(/--model\s+(\S+)/);
        const model = modelMatch ? modelMatch[1].trim() : null;

        const promptPayload = payload.replace(/--driver\s+\S+/, '').replace(/--model\s+\S+/, '');
        const promptMatch = promptPayload.match(/--prompt\s+(.+)$/);
        const systemPrompt = promptMatch ? promptMatch[1].trim() : null;

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: '❌ Error: No agent registry configured.' });
            return;
        }

        await agentRegistry.saveAgent(name, { driver, systemPrompt, model });

        const modelSuffix = model ? ` (${model})` : '';
        const msg = `✅ Created agent: *${name}* using driver *${driver}*${modelSuffix}`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}

export class DeleteCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/delete');
    }

    describe() {
        return { usage: '/delete <name>', description: 'Delete an agent', group: 'Agents' };
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const name = payload.split(' ')[1];

        if (!name) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: '❌ Usage: /delete <name>' });
            return;
        }

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) return;

        const agent = await agentRegistry.getAgent(name);
        if (!agent) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: `❌ Agent *${name}* not found.` });
            return;
        }

        await agentRegistry.deleteAgent(name);

        const storage = registry.getStorage();
        if (storage && typeof storage.deleteSessionsByPrefix === 'function') {
            await storage.deleteSessionsByPrefix(`${name}:`);
        }

        const msg = `🗑️ Deleted agent: *${name}* and its session memory.`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}

export class ListAgentsCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && ['/agents', '/list', '/ls'].includes(payload.trim());
    }

    describe() {
        return { usage: '/agents', description: 'List all agents', group: 'Agents' };
    }

    async execute({ sessionId, registry, eventBus }) {
        try {
            const agentRegistry = registry.getAgentRegistry();
            if (!agentRegistry) return;

            const agents = await agentRegistry.listAgents();
            if (agents.length === 0) {
                const msg = '🐾 No agents registered yet. Use `/new <name>` to spawn one!';
                eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
                eventBus.publish({ type: 'command.complete', sessionId, result: msg });
                return;
            }

            let msg = '🤖 *Active Agents:*\n';
            agents.forEach(a => {
                const modelLabel = a.model ? ` [${a.model}]` : '';
                msg += `- *${a.name}* (*${a.driver}*${modelLabel})${a.systemPrompt ? ' | ' + a.systemPrompt.substring(0, 30) + '...' : ''}\n`;
            });

            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
            eventBus.publish({ type: 'command.complete', sessionId, result: msg });
        } catch (err) {
            this.logger.error('[ListAgentsCommand] Error:', err);
            eventBus.publish({ type: 'command.complete', sessionId, result: '❌ Error listing agents: ' + err.message });
        }
    }
}

export class SetModelCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/setmodel');
    }

    describe() {
        return { usage: '/setmodel <agent> <model>', description: "Update an agent's model", group: 'Agents' };
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const parts = payload.split(' ');
        const name = parts[1];
        const model = parts[2];

        if (!name || !model) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: '❌ Usage: /setmodel <agent> <model>' });
            return;
        }

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: '❌ Error: No agent registry configured.' });
            return;
        }

        const existingConfig = await agentRegistry.getAgent(name);
        if (!existingConfig) {
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: `❌ Agent *${name}* not found.` });
            return;
        }

        await agentRegistry.saveAgent(name, { ...existingConfig, model });

        const msg = `✅ *${name}* will now use model *${model}*`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}
