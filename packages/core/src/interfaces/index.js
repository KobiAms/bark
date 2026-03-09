/**
 * Represents a normalized event within the Bark orchestration layer.
 *
 * @typedef {Object} BarkEvent
 * @property {string} type - Event type (e.g., 'message.received', 'stream.chunk', 'error.occurred')
 * @property {string} sessionId - Identifier for the conversation/user
 * @property {string} [adapterName] - The name of the adapter that originated this event (injected by BarkCore)
 * @property {string} payload - The message text
 * @property {Object} [quotedMessageMetadata] - Optional metadata about a message being replied to
 * @property {string} [quotedMessageMetadata.senderName] - The name of the agent or user being replied to
 * @property {Error} [error] - Error object, if this is an error event
 * @property {Date} timestamp - Time the event occurred
 */

/**
 * Thrown when an interface method is not implemented.
 */
class NotImplementedError extends Error {
    constructor(methodName) {
        super(`Method '${methodName}' must be implemented.`);
        this.name = 'NotImplementedError';
    }
}

/**
 * IAdapter Contract
 * Connects external platforms (e.g. WhatsApp, Telegram) to the Bark Core.
 */
export class IAdapter {
    /**
     * Start the adapter and connect to the underlying platform.
     * @returns {Promise<void>}
     */
    async start() { throw new NotImplementedError('start'); }

    /**
     * Stop the adapter and gracefully disconnect.
     * @returns {Promise<void>}
     */
    async stop() { throw new NotImplementedError('stop'); }

    /**
     * Send a complete message back to the originating session.
     * Called by core when a driver or command finishes its response.
     * May return { messageId } for adapters that support live editing — core stores
     * this to issue subsequent editMessage calls. Returning nothing is valid.
     * @param {string} sessionId
     * @param {any} payload
     * @returns {Promise<{messageId?: string}|void>}
     */
    async sendMessage(sessionId, payload) { throw new NotImplementedError('sendMessage'); }

    /**
     * Edit a previously sent message in-place (for live progress updates).
     * Only called if sendMessage returned a messageId. No-op by default — adapters
     * that don't support editing simply inherit this and do nothing.
     * @param {string} sessionId
     * @param {string} messageId
     * @param {string} text
     * @returns {Promise<void>}
     */
    async editMessage(sessionId, messageId, text) { /* no-op by default */ }

    /**
     * Send a single streaming chunk back to the originating session.
     * Called by core for every stream.chunk event. Adapters that don't support
     * streaming can leave this as a no-op (default behavior).
     * @param {string} sessionId
     * @param {string} chunk
     * @returns {Promise<void>}
     */
    async sendChunk(sessionId, chunk) { /* no-op by default */ }

    /**
     * Broadcast a message to the adapter's configured channel without a sessionId.
     * Used for system announcements (e.g. "✅ Bark Core is online!" after restart).
     * No-op by default — adapters that don't have a fixed channel can skip this.
     * @param {string} text
     * @returns {Promise<void>}
     */
    async announce(text) { /* no-op by default */ }

    /**
     * Register a callback for incoming messages from the platform.
     * @param {function(BarkEvent):void} cb
     */
    onMessage(cb) { throw new NotImplementedError('onMessage'); }

    /**
     * Register a callback for adapter-level errors.
     * @param {function(Error):void} cb
     */
    onError(cb) { throw new NotImplementedError('onError'); }
}

/**
 * IDriver Contract
 * Interfaces with a specific AI Agent Runtime (e.g. Claude Code, Gemini).
 */
export class IDriver {
    /**
     * Spawn or warm up a runtime process with the given configuration.
     * @param {Object} config
     * @returns {Promise<void>}
     */
    async spawn(config) { throw new NotImplementedError('spawn'); }

    /**
     * Stop the runtime and cleanly kill all active sessions.
     * @returns {Promise<void>}
     */
    async stop() { throw new NotImplementedError('stop'); }

    /**
     * Send a command/prompt to the runtime.
     * @param {string} sessionId
     * @param {string} cmd
     * @param {string} [systemPrompt] - Optional system instructions for this command/session
     * @returns {Promise<void>}
     */
    async sendCommand(sessionId, cmd, systemPrompt) { throw new NotImplementedError('sendCommand'); }

    /**
     * Kill the runtime process for the given session.
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async kill(sessionId) { throw new NotImplementedError('kill'); }

    /**
     * Register a callback for real-time text stream chunks.
     * @param {function({sessionId: string, chunk: string}):void} cb
     */
    onStream(cb) { throw new NotImplementedError('onStream'); }

    /**
     * Register a callback for intermediate progress updates (thinking, tool calls).
     * Called more frequently than onStream — used for live message editing.
     * Optional: drivers that don't implement progress simply never call this.
     * @param {function({sessionId: string, progressText: string}):void} cb
     */
    onProgress(cb) { /* no-op by default */ }

    /**
     * Register a callback for driver-level errors.
     * @param {function(Error):void} cb
     */
    onError(cb) { throw new NotImplementedError('onError'); }

    /**
     * Register a callback when a command execution completes.
     * @param {function({sessionId: string, result: any}):void} cb
     */
    onComplete(cb) { throw new NotImplementedError('onComplete'); }
}

/**
 * IStorage Contract
 * Pluggable state management (e.g. Memory, JSON, SQLite).
 */
export class IStorage {
    /**
     * @param {string} sessionId
     * @returns {Promise<Object>}
     */
    async getSession(sessionId) { throw new NotImplementedError('getSession'); }

    /**
     * @param {string} sessionId
     * @param {Object} state
     * @returns {Promise<void>}
     */
    async saveSession(sessionId, state) { throw new NotImplementedError('saveSession'); }

    /**
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async deleteSession(sessionId) { throw new NotImplementedError('deleteSession'); }

    /**
     * Delete multiple sessions by a prefix string.
     * Useful for cleaning up all sessions generated by a specific pseudo-id.
     * @param {string} prefix
     * @returns {Promise<void>}
     */
    async deleteSessionsByPrefix(prefix) { throw new NotImplementedError('deleteSessionsByPrefix'); }
}

/**
 * IAgentRegistry Contract
 * Handles persistence and lifecycle of defined agents (pups).
 */
export class IAgentRegistry {
    /**
     * @param {string} name
     * @returns {Promise<Object>}
     */
    async getAgent(name) { throw new NotImplementedError('getAgent'); }

    /**
     * @param {string} name
     * @param {Object} config - { driver, systemPrompt, ... }
     * @returns {Promise<void>}
     */
    async saveAgent(name, config) { throw new NotImplementedError('saveAgent'); }

    /**
     * @param {string} name
     * @returns {Promise<void>}
     */
    async deleteAgent(name) { throw new NotImplementedError('deleteAgent'); }

    /**
     * @returns {Promise<Array<Object>>}
     */
    async listAgents() { throw new NotImplementedError('listAgents'); }
}

/**
 * ICommand Contract
 * Intercepts specific intents to perform administrative or custom actions.
 */
export class ICommand {
    /**
     * Returns true if this command should handle the incoming message.
     * @param {any} message
     * @returns {boolean}
     */
    match(message) { throw new NotImplementedError('match'); }

    /**
     * Execute the command logic.
     * @param {Object} commandContext
     * @returns {Promise<any>}
     */
    async execute(commandContext) { throw new NotImplementedError('execute'); }
}
