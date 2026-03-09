import { ICommand } from '@bark/core';

export class CreateCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/create');
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const parts = payload.split(' ');
        const name = parts[1];
        
        if (!name || name.startsWith('--')) {
            eventBus.publish({ 
                type: 'stream.chunk', 
                sessionId, 
                chunk: '❌ Usage: /create <name> --prompt <prompt>' 
            });
            return;
        }

        const promptMatch = payload.match(/--prompt\s+(.+)$/);
        const systemPrompt = promptMatch ? promptMatch[1].trim() : null;

        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) {
            eventBus.publish({ 
                type: 'stream.chunk', 
                sessionId, 
                chunk: '❌ Error: No agent registry configured.' 
            });
            return;
        }

        const driver = Array.from(registry.drivers.keys())[0] || 'claude';

        await agentRegistry.saveAgent(name, {
            driver,
            systemPrompt
        });

        const msg = `✅ Created pup: *${name}* using driver *${driver}*`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}

export class DeleteCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/delete');
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
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: `❌ Pup *${name}* not found.` });
            return;
        }

        await agentRegistry.deleteAgent(name);
        const msg = `🗑️ Deleted pup: *${name}*`;
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}

export class ListAgentsCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && (payload.trim() === '/pups' || payload.trim() === '/agents');
    }

    async execute({ sessionId, registry, eventBus }) {
        const agentRegistry = registry.getAgentRegistry();
        if (!agentRegistry) return;

        const agents = await agentRegistry.listAgents();
        if (agents.length === 0) {
            const msg = '🐾 No pups registered yet. Use `/create <name>` to spawn one!';
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
            return;
        }

        let msg = '🐕 *Active Pups:*\n';
        agents.forEach(a => {
            msg += `- *${a.name}* (${a.driver})${a.systemPrompt ? ': ' + a.systemPrompt.substring(0, 50) + '...' : ''}\n`;
        });

        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}
