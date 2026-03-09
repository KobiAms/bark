import { ICommand } from '@bark/core';
export { RestartCommand } from './restart.js';

export class NewCommand extends ICommand {
    match(payload) {
        return typeof payload === 'string' && payload.startsWith('/new');
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        const parts = payload.split(' ');
        const name = parts[1];
        
        if (!name || name.startsWith('--')) {
            eventBus.publish({ 
                type: 'stream.chunk', 
                sessionId, 
                chunk: '❌ Usage: /new <name> --prompt <prompt>' 
            });
            return;
        }

        const driverMatch = payload.match(/--driver\s+(\S+)/);
        const driver = driverMatch ? driverMatch[1].trim() : (Array.from(registry.drivers.keys())[0] || 'claude');

        const promptPayload = payload.replace(/--driver\s+\S+/, '');
        const promptMatch = promptPayload.match(/--prompt\s+(.+)$/);
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


        await agentRegistry.saveAgent(name, {
            driver,
            systemPrompt
        });

        const msg = `✅ Created agent: *${name}* using driver *${driver}*`;
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
            eventBus.publish({ type: 'stream.chunk', sessionId, chunk: `❌ Agent *${name}* not found.` });
            return;
        }

        await agentRegistry.deleteAgent(name);

        // Clean up orphaned session memory
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
        return typeof payload === 'string' && payload.trim() === '/agents';
    }

    async execute({ sessionId, registry, eventBus }) {
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
            msg += `- *${a.name}* (${a.driver})${a.systemPrompt ? ': ' + a.systemPrompt.substring(0, 50) + '...' : ''}\n`;
        });

        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: msg });
        eventBus.publish({ type: 'command.complete', sessionId, result: msg });
    }
}
