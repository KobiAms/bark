import { ICommand } from '@bark/core';

export class StopCommand extends ICommand {
    match(message) {
        if (typeof message !== 'string') return false;
        const trimmed = message.trim().toLowerCase();
        return trimmed === '/stop' || trimmed.startsWith('/stop ');
    }

    describe() {
        return {
            usage: '/stop [@agent]',
            description: 'Stop a running agent or all sessions',
            group: 'System'
        };
    }

    async execute({ sessionId, payload, registry, targetAgentName }) {
        const match = payload.match(/@(\w+)/);
        const targetAgent = match ? match[1] : targetAgentName;

        // Build effective session IDs to kill
        const sessionIdsToKill = [];
        if (targetAgent) {
            sessionIdsToKill.push(`${targetAgent}:${sessionId}`);
        } else {
            sessionIdsToKill.push(sessionId);
            // Also try agent-prefixed sessions
            const agentRegistry = registry.getAgentRegistry();
            if (agentRegistry) {
                const agents = await agentRegistry.listAgents().catch(() => []);
                for (const agent of agents) {
                    sessionIdsToKill.push(`${agent.name}:${sessionId}`);
                }
            }
        }

        // Kill matching sessions across all drivers
        const killed = [];
        for (const sid of sessionIdsToKill) {
            for (const [driverName, driver] of registry.drivers.entries()) {
                try {
                    await driver.kill(sid);
                    killed.push(sid);
                } catch {
                    // driver.kill throws/no-ops if session doesn't exist — that's fine
                }
            }
        }

        return killed.length > 0
            ? `🛑 Stopped ${killed.length} session${killed.length > 1 ? 's' : ''}`
            : '⚠️ No active sessions to stop';
    }
}
