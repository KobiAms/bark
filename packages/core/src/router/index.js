export class MessageRouter {
    /**
     * @param {import('../bus/index.js').EventBus} eventBus
     * @param {import('../registry/index.js').ExtensionRegistry} registry
     */
    constructor(eventBus, registry) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.defaultDriverName = null;

        // Maps sessionId -> { adapterName, replyTo? }
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

    // --- Routing helpers ---

    _getAdapterAndReplyTo(sessionId) {
        const routing = this.sessionRouting.get(sessionId);
        if (!routing) return null;
        return {
            adapter: this.registry.getAdapter(routing.adapterName),
            replyTo: routing.replyTo || sessionId,
            adapterName: routing.adapterName,
        };
    }

    /**
     * Route a response payload back to the adapter that originated the session.
     */
    _routeResponse(sessionId, method, payload) {
        if (payload == null) return;
        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;
        r.adapter[method](r.replyTo, payload).catch(err =>
            console.error(`[MessageRouter] Failed to route ${method} to adapter '${r.adapterName}':`, err)
        );
    }

    /**
     * Send a one-off reply directly to the originating adapter via sendMessage.
     * Used for router-generated messages (errors, hints) that are NOT streaming chunks.
     */
    async _replyToSender(sessionId, text) {
        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;
        await r.adapter.sendMessage(r.replyTo, text).catch(err =>
            console.error(`[MessageRouter] Failed to reply to session '${sessionId}':`, err)
        );
    }

    async _onCommandComplete(event) {
        if (event.result == null) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;
        const sent = await r.adapter.sendMessage(r.replyTo, event.result).catch(() => null);
        if (sent?.messageId) {
            this.liveMessageIds.set(event.sessionId, sent.messageId);
        }
    }

    _onStreamChunk(event) {
        if (event.chunk == null) return;
        this._routeResponse(event.sessionId, 'sendChunk', event.chunk);
    }

    /**
     * Throttled live progress edit.
     * Edits the placeholder message in-place if the adapter supports it.
     */
    _onStreamProgress(event) {
        if (!event.progressText) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        const messageId = this.liveMessageIds.get(event.sessionId);
        if (!messageId) return;

        const throttleMs = r.adapter.editThrottleMs ?? 2000;
        const lastEdit = this.lastEditTime.get(event.sessionId) || 0;
        if (Date.now() - lastEdit < throttleMs) return;

        this.lastEditTime.set(event.sessionId, Date.now());
        r.adapter.editMessage(r.replyTo, messageId, event.progressText).catch(() => {});
    }

    /**
     * On driver complete: do a final edit if we have a live message, otherwise send fresh.
     */
    _onDriverComplete(event) {
        if (event.result == null) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        const messageId = this.liveMessageIds.get(event.sessionId);
        this.liveMessageIds.delete(event.sessionId);
        this.lastEditTime.delete(event.sessionId);

        if (messageId) {
            r.adapter.editMessage(r.replyTo, messageId, event.result).catch(() => {
                // Fallback: if edit fails, send as new message
                r.adapter.sendMessage(r.replyTo, event.result).catch(() => {});
            });
        } else {
            r.adapter.sendMessage(r.replyTo, event.result).catch(err =>
                console.error(`[MessageRouter] Failed to send complete to adapter '${r.adapterName}':`, err)
            );
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
        this.sessionRouting.set(sessionId, { adapterName });

        try {
            // 1. Check for commands
            for (const command of this.registry.getAllCommands()) {
                if (command.match(payload)) {
                    await command.execute({
                        sessionId,
                        payload,
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

            // A. Reply-To Routing
            if (agentRegistry && event.quotedMessageMetadata?.senderName) {
                const quotedName = event.quotedMessageMetadata.senderName;
                const agent = await agentRegistry.getAgent(quotedName);
                if (agent) {
                    targetAgentName = quotedName;
                    targetDriverName = agent.driver;
                    targetSystemPrompt = agent.systemPrompt;
                    targetPayload = trimmedPayload;
                }
            }

            // B. Mention Detection (@name)
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
                            await this._replyToSender(sessionId, `🤖 @${rawName} is listening! What would you like to ask?`);
                            return;
                        }
                    } else {
                        await this._replyToSender(sessionId, `❓ Unknown agent: @${rawName}`);
                        return;
                    }
                }
            }

            // 3. Session Management
            const effectiveSessionId = targetAgentName || sessionId;

            // For agent sessions, store routing so replies go back to the originating user session
            if (targetAgentName) {
                this.sessionRouting.set(effectiveSessionId, { adapterName, replyTo: sessionId });
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

            const driverName = session.driverName;
            const driver = this.registry.getDriver(driverName);

            if (!driver) {
                console.error(`[MessageRouter] Driver '${driverName}' not found.`);
                this.eventBus.publish({ type: 'error.occurred', sessionId: effectiveSessionId, error: new Error(`Driver ${driverName} not found`) });
                return;
            }

            // 4. Route to Driver
            // Send a "thinking..." placeholder and store its messageId for live editing
            const routing = this.sessionRouting.get(effectiveSessionId);
            if (routing) {
                const adapter = this.registry.getAdapter(routing.adapterName);
                const replyTo = routing.replyTo || effectiveSessionId;
                if (adapter) {
                    const sent = await adapter.sendMessage(replyTo, '_thinking..._').catch(() => null);
                    if (sent?.messageId) {
                        this.liveMessageIds.set(effectiveSessionId, sent.messageId);
                    }
                }
            }

            this.eventBus.publish({ type: 'driver.thinking', sessionId: effectiveSessionId });
            await driver.sendCommand(effectiveSessionId, targetPayload, targetSystemPrompt);

        } catch (error) {
            console.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: 'error.occurred', sessionId, error });
            await this._replyToSender(sessionId, `❌ ${error.message}`);
        }
    }
}
