import { IStorage } from '@bark/core';

export class MemoryStorage extends IStorage {
    constructor() {
        super();
        this.sessions = new Map(); // sessionId -> state
        this.agents = new Map();   // agentId -> state
    }

    async getSession(sessionId) {
        return this.sessions.get(sessionId) || null;
    }

    async saveSession(sessionId, state) {
        this.sessions.set(sessionId, state);
    }

    async getAgentState(agentId) {
        return this.agents.get(agentId) || null;
    }

    async updateAgentState(agentId, state) {
        this.agents.set(agentId, state);
    }
}
