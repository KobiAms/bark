import { IStorage, IAgentRegistry } from '@bark/core';

export class MemoryStorage extends IStorage {
    constructor() {
        super();
        this.sessions = new Map(); // sessionId -> state
    }

    async getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    async saveSession(sessionId, state) {
        this.sessions.set(sessionId, state);
    }

    async deleteSession(sessionId) {
        this.sessions.delete(sessionId);
    }

    async deleteSessionsByPrefix(prefix) {
        for (const sessionId of this.sessions.keys()) {
            if (sessionId.startsWith(prefix)) {
                this.sessions.delete(sessionId);
            }
        }
    }
}

export class MemoryAgentRegistry extends IAgentRegistry {
    constructor() {
        super();
        this.agents = new Map(); // name -> config
    }

    async getAgent(name) {
        return this.agents.get(name) || null;
    }

    async saveAgent(name, config) {
        this.agents.set(name, config);
    }

    async deleteAgent(name) {
        this.agents.delete(name);
    }

    async listAgents() {
        return Array.from(this.agents.entries()).map(([name, config]) => ({
            name,
            ...config
        }));
    }
}
