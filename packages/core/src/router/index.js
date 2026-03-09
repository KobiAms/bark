const DRIVER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class MessageRouter {
    /**
     * @param {import('../bus/index.js').EventBus} eventBus
     * @param {import('../registry/index.js').ExtensionRegistry} registry
     */
    constructor(eventBus, registry) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.defaultDriverName = null;

        // Maps sessionId -> { adapterName, replyTo?, lastMessageId? }
        this.sessionRouting = new Map();

        // Maps sessionId -> messageId of the live placeholder message (for editing)
        this.liveMessageIds = new Map();

        // Maps sessionId -> timestamp of last editMessage call (for throttling)
        this.lastEditTime = new Map();

        this._unsubs = [];
    }

    setDefaultDriver(name) {
        this.defaultDriverName = name;
    }

    start() {
        this._unsubs.push(
            this.eventBus.subscribe('message.received', (event) => this.handleIncomingMessage(event)),
            this.eventBus.subscribe('stream.chunk',     (event) => this._onStreamChunk(event)),
            this.eventBus.subscribe('stream.progress',  (event) => this._onStreamProgress(event)),
            this.eventBus.subscribe('driver.complete',  (event) => this._onDriverComplete(event)),
            this.eventBus.subscribe('command.complete', (event) => this._onCommandComplete(event))
        );
    }

    stop() {
        this._unsubs.forEach(fn => fn());
        this._unsubs = [];
    }

    // --- messageToAgent persistence ---
    // Persisted via storage so reply-to routing survives restarts.

    async _setMessageAgent(messageId, agentName) {
        const storage = this.registry.getStorage();
        if (!storage) return;
        await storage.saveSession(`__mta:${messageId}`, { agentName }).catch(() => {});
    }

    async _getMessageAgent(messageId) {
        const storage = this.registry.getStorage();
        if (!storage) return null;
        const data = await storage.getSession(`__mta:${messageId}`).catch(() => null);
        return data?.agentName || null;
    }

    // --- Routing helpers ---

    _getAgentPrefix(sessionId) {
        if (sessionId.includes(':')) {
            const agentName = sessionId.split(':')[0];
            return `*@${agentName}*\n\n`;
        }
        return '';
    }

    _getAdapterAndReplyTo(sessionId) {
        const routing = this.sessionRouting.get(sessionId);
        if (!routing) return null;
        return {
            adapter: this.registry.getAdapter(routing.adapterName),
            replyTo: routing.replyTo || sessionId,
            adapterName: routing.adapterName,
            lastMessageId: routing.lastMessageId
        };
    }

    async _replyToSender(sessionId, text) {
        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;
        await r.adapter.sendMessage(r.replyTo, text, { replyToMessageId: r.lastMessageId }).catch(err =>
            console.error(`[MessageRouter] Failed to reply to session '${sessionId}':`, err)
        );
    }

    /**
     * Edit the live placeholder if one exists, otherwise send a new message.
     * Cleans up liveMessageIds and lastEditTime for the session.
     */
    async _editOrSend(effectiveSessionId, text) {
        const r = this._getAdapterAndReplyTo(effectiveSessionId);
        if (!r?.adapter) return null;

        const messageId = this.liveMessageIds.get(effectiveSessionId);
        this.liveMessageIds.delete(effectiveSessionId);
        this.lastEditTime.delete(effectiveSessionId);

        if (messageId) {
            await r.adapter.editMessage(r.replyTo, messageId, text).catch(async () => {
                await r.adapter.sendMessage(r.replyTo, text, { replyToMessageId: r.lastMessageId }).catch(() => {});
            });
            return messageId;
        } else {
            const sent = await r.adapter.sendMessage(r.replyTo, text, { replyToMessageId: r.lastMessageId }).catch(() => null);
            return sent?.messageId || null;
        }
    }

    async _onCommandComplete(event) {
        if (event.result == null) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;
        const prefix = this._getAgentPrefix(event.sessionId);
        const sent = await r.adapter.sendMessage(r.replyTo, prefix + event.result, { replyToMessageId: r.lastMessageId }).catch(() => null);
        if (sent?.messageId) {
            this.liveMessageIds.set(event.sessionId, sent.messageId);
        }
    }

    _onStreamChunk(event) {
        if (event.chunk == null) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;
        r.adapter.sendChunk(r.replyTo, event.chunk).catch(err =>
            console.error(`[MessageRouter] Failed to route sendChunk to adapter '${r.adapterName}':`, err)
        );
    }

    _onStreamProgress(event) {
        if (!event.progressText) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        const messageId = this.liveMessageIds.get(event.sessionId);
        if (!messageId) return;

        // Thinking updates can be more frequent
        const throttleMs = event.isThinking
            ? (r.adapter.thinkingThrottleMs ?? 800)
            : (r.adapter.editThrottleMs ?? 2000);
        const lastEdit = this.lastEditTime.get(event.sessionId) || 0;
        if (Date.now() - lastEdit < throttleMs) return;

        this.lastEditTime.set(event.sessionId, Date.now());
        const prefix = this._getAgentPrefix(event.sessionId);
        r.adapter.editMessage(r.replyTo, messageId, prefix + event.progressText).catch(() => {});
    }

    async _onDriverComplete(event) {
        if (event.result == null) return;

        const prefix = this._getAgentPrefix(event.sessionId);
        const result = prefix + (event.result.trim() || 'Done.');

        const sentMessageId = await this._editOrSend(event.sessionId, result);

        // Persist messageId → agentName so reply-to routing works after restart
        if (sentMessageId && event.sessionId.includes(':')) {
            const agentName = event.sessionId.split(':')[0];
            const agentRegistry = this.registry.getAgentRegistry();
            const agent = agentRegistry ? await agentRegistry.getAgent(agentName).catch(() => null) : null;
            if (agent) {
                await this._setMessageAgent(sentMessageId, agentName);
            }
        }
    }

    /**
     * @param {import('../interfaces/index.js').BarkEvent} event
     */
    async handleIncomingMessage(event) {
        const { sessionId, payload, adapterName } = event;
        const storage = this.registry.getStorage();

        if (!storage) {
            console.error('[MessageRouter] No storage plugin registered. Cannot process message.');
            this.eventBus.publish({ type: 'error.occurred', sessionId, error: new Error('No storage plugin') });
            return;
        }

        // Store routing info for this session so responses go back to the right adapter
        this.sessionRouting.set(sessionId, { adapterName, lastMessageId: event.rawId });

        try {
            // 1. Check for commands
            for (const command of this.registry.getAllCommands()) {
                if (command.match(payload)) {
                    await command.execute({
                        sessionId,
                        payload,
                        adapterName,
                        registry: this.registry,
                        eventBus: this.eventBus,
                        storage
                    });
                    return;
                }
            }

            // 2. Routing Detection (Mentions vs Replies)
            let targetPayload = payload;
            let targetAgentName = null;
            let targetDriverName = this.defaultDriverName;
            let targetSystemPrompt = null;

            const agentRegistry = this.registry.getAgentRegistry();
            const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';

            // A. Reply-To Routing — persisted, survives restart
            if (agentRegistry && event.quotedMessageMetadata?.messageId) {
                const agentName = await this._getMessageAgent(event.quotedMessageMetadata.messageId);
                if (agentName) {
                    const agent = await agentRegistry.getAgent(agentName);
                    if (agent) {
                        targetAgentName = agentName;
                        targetDriverName = agent.driver;
                        targetSystemPrompt = agent.systemPrompt;
                        targetPayload = trimmedPayload;
                    }
                }
            }

            // B. senderName fallback (for clients that don't expose messageId)
            if (!targetAgentName && agentRegistry && event.quotedMessageMetadata?.senderName) {
                const agent = await agentRegistry.getAgent(event.quotedMessageMetadata.senderName);
                if (agent) {
                    targetAgentName = event.quotedMessageMetadata.senderName;
                    targetDriverName = agent.driver;
                    targetSystemPrompt = agent.systemPrompt;
                    targetPayload = trimmedPayload;
                }
            }

            // C. Mention Detection (@name)
            if (!targetAgentName && trimmedPayload.startsWith('@')) {
                const parts = trimmedPayload.split(/\s+/);
                const rawName = parts[0].substring(1);

                if (agentRegistry) {
                    const agent = await agentRegistry.getAgent(rawName);
                    if (agent) {
                        targetAgentName = rawName;
                        targetDriverName = agent.driver;
                        targetSystemPrompt = agent.systemPrompt;

                        const nameIndex = payload.indexOf('@' + rawName);
                        targetPayload = payload.substring(nameIndex + rawName.length + 1).trim();

                        if (!targetPayload) {
                            await this._replyToSender(sessionId, `*@${rawName}* is listening! What would you like to ask?`);
                            return;
                        }
                    } else {
                        await this._replyToSender(sessionId, `❓ Unknown agent: @${rawName}`);
                        return;
                    }
                }
            }

            // 3. Session Management
            const effectiveSessionId = targetAgentName ? `${targetAgentName}:${sessionId}` : sessionId;

            if (targetAgentName) {
                this.sessionRouting.set(effectiveSessionId, {
                    adapterName,
                    replyTo: sessionId,
                    lastMessageId: event.rawId
                });
            }

            let session = await storage.getSession(effectiveSessionId);
            if (!session) {
                const availableDrivers = Array.from(this.registry.drivers.keys());
                session = {
                    sessionId: effectiveSessionId,
                    driverName: targetDriverName || availableDrivers[0]
                };
                await storage.saveSession(effectiveSessionId, session);
            }

            const driver = this.registry.getDriver(session.driverName);
            if (!driver) {
                console.error(`[MessageRouter] Driver '${session.driverName}' not found.`);
                await this._replyToSender(sessionId, `❌ Driver '${session.driverName}' not found.`);
                return;
            }

            // 4. Send thinking placeholder and store messageId for live edits
            const routing = this.sessionRouting.get(effectiveSessionId);
            if (routing) {
                const adapter = this.registry.getAdapter(routing.adapterName);
                const replyTo = routing.replyTo || effectiveSessionId;
                if (adapter) {
                    const prefix = this._getAgentPrefix(effectiveSessionId);
                    const sent = await adapter.sendMessage(replyTo, prefix + '_thinking..._', { replyToMessageId: routing.lastMessageId }).catch(() => null);
                    if (sent?.messageId) {
                        this.liveMessageIds.set(effectiveSessionId, sent.messageId);
                        // Persist thinking message → agent mapping too (for immediate reply-to)
                        if (targetAgentName) {
                            await this._setMessageAgent(sent.messageId, targetAgentName);
                        }
                    }
                }
            }

            // 5. Run driver with timeout
            this.eventBus.publish({ type: 'driver.thinking', sessionId: effectiveSessionId });

            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(Object.assign(
                        new Error('⏱️ No response after 5 minutes. The session was cancelled.'),
                        { isTimeout: true }
                    )), DRIVER_TIMEOUT_MS)
                );
                await Promise.race([
                    driver.sendCommand(effectiveSessionId, targetPayload, targetSystemPrompt),
                    timeoutPromise
                ]);
            } catch (driverError) {
                if (driverError.isTimeout) {
                    await driver.kill(effectiveSessionId).catch(() => {});
                } else {
                    console.error(`[MessageRouter] Driver error for session ${effectiveSessionId}:`, driverError);
                }
                await this._editOrSend(effectiveSessionId, `❌ ${driverError.message}`);
            }

        } catch (error) {
            console.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: 'error.occurred', sessionId, error });
            await this._replyToSender(sessionId, `❌ ${error.message}`);
        }
    }
}
