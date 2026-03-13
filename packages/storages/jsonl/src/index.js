import { IStorage, IAgentRegistry } from '@bark/core';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import readline from 'readline';

export class JsonlStorage extends IStorage {
    /**
     * @param {Object} [options]
     * @param {string|null} [options.filePath] - Path to the sessions.jsonl file. Omit or pass null for in-memory only.
     */
    constructor(options = {}) {
        super();
        this.filePath = options.filePath || null;
        this.sessions = new Map();
        this.initialized = !this.filePath;

        if (this.filePath) {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(this.filePath)) {
                fs.writeFileSync(this.filePath, '');
            }
        }
    }

    async _ensureInitialized() {
        if (this.initialized) return;

        const fileStream = fs.createReadStream(this.filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                if (entry.deleted) {
                    this.sessions.delete(entry.sessionId);
                } else if (entry.deletedByPrefix) {
                    for (const key of this.sessions.keys()) {
                        if (key.startsWith(entry.prefix)) {
                            this.sessions.delete(key);
                        }
                    }
                } else {
                    this.sessions.set(entry.sessionId, entry.state);
                }
            } catch (err) {
                this.logger.warn(`[JsonlStorage] Failed to parse line: ${err.message}`);
            }
        }
        this.initialized = true;
    }

    async getSession(sessionId) {
        await this._ensureInitialized();
        return this.sessions.get(sessionId) || null;
    }

    async saveSession(sessionId, state) {
        await this._ensureInitialized();
        this.sessions.set(sessionId, state);
        if (this.filePath) {
            await fsPromises.appendFile(this.filePath, JSON.stringify({ sessionId, state, timestamp: Date.now() }) + '\n');
        }
    }

    async deleteSession(sessionId) {
        await this._ensureInitialized();
        this.sessions.delete(sessionId);
        if (this.filePath) {
            await fsPromises.appendFile(this.filePath, JSON.stringify({ sessionId, deleted: true, timestamp: Date.now() }) + '\n');
        }
    }

    async deleteSessionsByPrefix(prefix) {
        await this._ensureInitialized();
        for (const sessionId of this.sessions.keys()) {
            if (sessionId.startsWith(prefix)) {
                this.sessions.delete(sessionId);
            }
        }
        if (this.filePath) {
            await fsPromises.appendFile(this.filePath, JSON.stringify({ deletedByPrefix: true, prefix, timestamp: Date.now() }) + '\n');
        }
    }

    async compact() {
        if (!this.filePath) return;
        await this._ensureInitialized();
        const lines = [];
        for (const [sessionId, state] of this.sessions.entries()) {
            lines.push(JSON.stringify({ sessionId, state, timestamp: Date.now() }));
        }
        await fsPromises.writeFile(this.filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
        this.logger.log(`[JsonlStorage] Compacted: ${lines.length} active sessions`);
    }
}

export class JsonlAgentRegistry extends IAgentRegistry {
    /**
     * @param {Object} [options]
     * @param {string|null} [options.filePath] - Path to the agents.jsonl file. Omit or pass null for in-memory only.
     */
    constructor(options = {}) {
        super();
        this.filePath = options.filePath || null;
        this.agents = new Map();
        this.initialized = !this.filePath;

        if (this.filePath) {
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            if (!fs.existsSync(this.filePath)) {
                fs.writeFileSync(this.filePath, '');
            }
        }
    }

    async _ensureInitialized() {
        if (this.initialized) return;

        const fileStream = fs.createReadStream(this.filePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        for await (const line of rl) {
            if (!line.trim()) continue;
            try {
                const entry = JSON.parse(line);
                const name = entry.name?.toLowerCase();
                if (!name) continue;
                if (entry.deleted) {
                    this.agents.delete(name);
                } else {
                    this.agents.set(name, entry.config);
                }
            } catch (err) {
                this.logger.warn(`[JsonlAgentRegistry] Failed to parse line: ${err.message}`);
            }
        }
        this.initialized = true;
    }

    async getAgent(name) {
        await this._ensureInitialized();
        const lowerName = name?.toLowerCase();
        const config = this.agents.get(lowerName);
        return config ? { name: lowerName, ...config } : null;
    }

    async saveAgent(name, config) {
        await this._ensureInitialized();
        const lowerName = name?.toLowerCase();
        this.agents.set(lowerName, config);
        if (this.filePath) {
            await fsPromises.appendFile(this.filePath, JSON.stringify({ name: lowerName, config, timestamp: Date.now() }) + '\n');
        }
    }

    async deleteAgent(name) {
        await this._ensureInitialized();
        const lowerName = name?.toLowerCase();
        this.agents.delete(lowerName);
        if (this.filePath) {
            await fsPromises.appendFile(this.filePath, JSON.stringify({ name: lowerName, deleted: true, timestamp: Date.now() }) + '\n');
        }
    }

    async listAgents() {
        await this._ensureInitialized();
        return Array.from(this.agents.entries()).map(([name, config]) => ({
            name,
            ...config
        }));
    }

    async compact() {
        if (!this.filePath) return;
        await this._ensureInitialized();
        const lines = [];
        for (const [name, config] of this.agents.entries()) {
            lines.push(JSON.stringify({ name, config, timestamp: Date.now() }));
        }
        await fsPromises.writeFile(this.filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''));
        this.logger.log(`[JsonlAgentRegistry] Compacted: ${lines.length} agents`);
    }
}

// In-memory convenience aliases (no file persistence)
export class MemoryStorage extends JsonlStorage {
    constructor() { super(); }
}

export class MemoryAgentRegistry extends JsonlAgentRegistry {
    constructor() { super(); }
}
