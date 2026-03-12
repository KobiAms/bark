import { ICommand } from '@bark/core';

export class NewCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/new');
    }

    describe() {
        return { usage: '/new <name> [<driver>] [--model <m>] [--prompt <p>]', description: 'Create a new agent', group: 'Agents' };
    }

    async execute({ payload, registry }) {
        const parts = payload.split(' ');
        const name = parts[1];

        if (!name || name.startsWith('--')) {
            return '❌ Usage: /new <name> [<driver>] [--model <model>] [--prompt <prompt>]';
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
            return '❌ Error: No agent registry configured.';
        }

        await agentRegistry.saveAgent(name, { driver, systemPrompt, model });

        const modelSuffix = model ? ` (${model})` : '';
        return `✅ Created agent: *${name}* using driver *${driver}*${modelSuffix}`;
    }
}

export class DeleteCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/delete');
    }

    describe() {
        return { usage: '/delete <name>', description: 'Delete an agent', group: 'Agents' };
    }

    async execute({ payload, registry }) {
        const name = payload.split(' ')[1];

        if (!name) {
            return '❌ Usage: /delete <name>';
        }

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) return;

        const agent = await agentRegistry.getAgent(name);
        if (!agent) {
            return `❌ Agent *${name}* not found.`;
        }

        await agentRegistry.deleteAgent(name);

        const storage = registry.getStorage();
        if (storage && typeof storage.deleteSessionsByPrefix === 'function') {
            await storage.deleteSessionsByPrefix(`${name}:`);
        }

        return `🗑️ Deleted agent: *${name}* and its session memory.`;
    }
}

export class ListAgentsCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && ['/agents', '/list', '/ls'].includes(payload.trim());
    }

    describe() {
        return { usage: '/agents', description: 'List all agents', group: 'Agents' };
    }

    async execute({ registry }) {
        try {
            const agentRegistry = registry.getAgentRegistry();
            if (!agentRegistry) return;

            const agents = await agentRegistry.listAgents();
            if (agents.length === 0) {
                return '🐾 No agents registered yet. Use `/new <name>` to spawn one!';
            }

            let msg = '🤖 *Active Agents:*\n';
            agents.forEach(a => {
                const modelLabel = a.model ? ` [${a.model}]` : '';
                msg += `- *${a.name}* (*${a.driver}*${modelLabel})${a.systemPrompt ? ' | ' + a.systemPrompt.substring(0, 30) + '...' : ''}\n`;
            });

            return msg;
        } catch (err) {
            this.logger.error('[ListAgentsCommand] Error:', err);
            return '❌ Error listing agents: ' + err.message;
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

    async execute({ payload, registry }) {
        const parts = payload.split(' ');
        const name = parts[1];
        const model = parts[2];

        if (!name || !model) {
            return '❌ Usage: /setmodel <agent> <model>';
        }

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) {
            return '❌ Error: No agent registry configured.';
        }

        const existingConfig = await agentRegistry.getAgent(name);
        if (!existingConfig) {
            return `❌ Agent *${name}* not found.`;
        }

        await agentRegistry.saveAgent(name, { ...existingConfig, model });

        return `✅ *${name}* will now use model *${model}*`;
    }
}
