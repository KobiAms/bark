import { EventTypes } from '../interfaces/index.js';
import { defaultLogger } from '../logger/index.js';

const DRIVER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class MessageRouter {
    /**
     * @param {import('../bus/index.js').EventBus} eventBus
     * @param {import('../registry/index.js').ExtensionRegistry} registry
     */
    constructor(eventBus, registry, logger = defaultLogger) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.logger = logger;
        this.defaultDriverName = null;

        // Maps sessionId -> { adapterName, replyTo?, lastMessageId? }
        this.sessionRouting = new Map();

        // Maps sessionId -> messageId of the live placeholder message (for editing)
        this.liveMessageIds = new Map();

        // Maps sessionId -> latest buffered progressText (updated on every event)
        this.pendingProgress = new Map();

        // Maps sessionId -> setInterval timer id for flushing progress to adapter
        this.progressTimers = new Map();

        // Maps sessionId -> flush count (for animated dots)
        this.flushCount = new Map();

        // Maps sessionId -> Date.now() when thinking started (for elapsed time display)
        this.thinkingStartTime = new Map();

        // Maps sessionId -> Promise of the last in-flight progress edit (to await before final edit)
        this.inFlightEdits = new Map();

        // Sessions that have been finalized (timed out or errored) — suppresses late driver.complete
        this.finishedSessions = new Set();

        this._unsubs = [];
        this.inputEvent = EventTypes.MESSAGE_RECEIVED;
    }

    setDefaultDriver(name) {
        this.defaultDriverName = name;
    }

    setInputEvent(eventType) {
        this.inputEvent = eventType;
    }

    start() {
        this._unsubs.push(
            this.eventBus.subscribe(this.inputEvent, (event) => this.handleIncomingMessage(event)),
            this.eventBus.subscribe(EventTypes.MESSAGE_RECEIVED, (event) => this.handleMediaIndicator(event)),
            this.eventBus.subscribe(EventTypes.STREAM_CHUNK,      (event) => this._onStreamChunk(event)),
            this.eventBus.subscribe(EventTypes.STREAM_PROGRESS,   (event) => this._onStreamProgress(event)),
            this.eventBus.subscribe(EventTypes.DRIVER_COMPLETE,   (event) => this._onDriverComplete(event)),
            this.eventBus.subscribe(EventTypes.COMMAND_COMPLETE,  (event) => this._onCommandComplete(event)),
            this.eventBus.subscribe(EventTypes.FILE_READY,        (event) => this._onFileReady(event))
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
            this.logger.error(`[MessageRouter] Failed to reply to session '${sessionId}':`, err)
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
        this._clearProgressTimer(effectiveSessionId);

        // Wait for any in-flight progress edit to settle before sending the final edit,
        // otherwise the progress edit can land AFTER the final one and overwrite it.
        const inFlight = this.inFlightEdits.get(effectiveSessionId);
        if (inFlight) {
            await inFlight;
            this.inFlightEdits.delete(effectiveSessionId);
        }

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

/**
 * Handle file ready events from drivers.
 * @param {import('../interfaces/index.js').BarkEvent} event
 */
async _onFileReady(event) {
    if (!event.filePath) return;
    const r = this._getAdapterAndReplyTo(event.sessionId);
    if (!r?.adapter) return;

    await r.adapter.sendFile(r.replyTo, {
        filePath: event.filePath,
        mimeType: event.mimeType,
        fileName: event.fileName,
        caption: event.caption
    }, { replyToMessageId: r.lastMessageId }).catch(err => {
        this.logger.error(`[MessageRouter] Failed to send file for session '${event.sessionId}':`, err);
    });
}

/**
 * Resolve which agent/driver should handle a payload.
 * @private
 */
async _resolveRouting(event) {
    const { payload } = event;
    const agentRegistry = this.registry.getAgentRegistry();
    const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';

    let targetAgentName = null;
    let targetDriverName = this.defaultDriverName;
    let targetSystemPrompt = null;
    let targetModel = null;
    let targetPayload = payload;

    // A. Mention Detection (@name) — explicit override takes precedence
    if (trimmedPayload.startsWith('@')) {
        const parts = trimmedPayload.split(/\s+/);
        const rawName = parts[0].substring(1);

        if (agentRegistry) {
            const agent = await agentRegistry.getAgent(rawName);
            if (agent) {
                targetAgentName = rawName;
                targetDriverName = agent.driver;
                targetSystemPrompt = agent.systemPrompt;
                targetModel = agent.model || null;

                const nameIndex = payload.indexOf('@' + rawName);
                targetPayload = payload.substring(nameIndex + rawName.length + 1).trim();

                // If replying to a message with quoted content, prepend it for context
                if (event.quotedMessageMetadata?.content) {
                    const quotedSender = event.quotedMessageMetadata.senderName || 'Previous message';
                    targetPayload = `[${quotedSender} said:]\n${event.quotedMessageMetadata.content}\n\n${targetPayload}`;
                }
            }
        }
    }

    // B. Reply-To Routing — persisted, survives restart
    if (!targetAgentName && agentRegistry && event.quotedMessageMetadata?.messageId) {
        const agentName = await this._getMessageAgent(event.quotedMessageMetadata.messageId);
        if (agentName) {
            const agent = await agentRegistry.getAgent(agentName);
            if (agent) {
                targetAgentName = agentName;
                targetDriverName = agent.driver;
                targetSystemPrompt = agent.systemPrompt;
                targetModel = agent.model || null;
                targetPayload = trimmedPayload;
            }
        }
    }

    // C. senderName fallback (for clients that don't expose messageId)
    if (!targetAgentName && agentRegistry && event.quotedMessageMetadata?.senderName) {
        const agent = await agentRegistry.getAgent(event.quotedMessageMetadata.senderName);
        if (agent) {
            targetAgentName = event.quotedMessageMetadata.senderName;
            targetDriverName = agent.driver;
            targetSystemPrompt = agent.systemPrompt;
            targetModel = agent.model || null;
            targetPayload = trimmedPayload;
        }
    }

    return { targetAgentName, targetDriverName, targetSystemPrompt, targetModel, targetPayload };
}

/**
 * Provide immediate feedback for non-text payloads (e.g. voice messages).
 * @param {import('../interfaces/index.js').BarkEvent} event
 */
async handleMediaIndicator(event) {
    // If the router is listening to MESSAGE_RECEIVED as its primary input, 
    // handleIncomingMessage will handle it. We only act here if there's a 
    // transformation plugin (like Whisper) in between.
    if (this.inputEvent === EventTypes.MESSAGE_RECEIVED) return;

    const { sessionId, payload, adapterName } = event;
    if (typeof payload === 'string') return; // Whisper or similar will handle text later

    // Store routing info for this session early so we can send the placeholder
    this.sessionRouting.set(sessionId, { adapterName, lastMessageId: event.rawId });

    const { targetAgentName } = await this._resolveRouting(event);
    const effectiveSessionId = targetAgentName ? `${targetAgentName}:${sessionId}` : sessionId;

    if (targetAgentName) {
        this.sessionRouting.set(effectiveSessionId, {
            adapterName,
            replyTo: sessionId,
            lastMessageId: event.rawId
        });
    }

    const adapter = this.registry.getAdapter(adapterName);
    if (adapter) {
        const prefix = this._getAgentPrefix(effectiveSessionId);
        const label = payload?.type === 'audio' ? '_listening..._' : '_processing..._';
        const placeholder = prefix ? prefix.trimEnd() + ' ' + label : label;

        const sent = await adapter.sendMessage(sessionId, placeholder, { replyToMessageId: event.rawId }).catch(() => null);
        if (sent?.messageId) {
            this.liveMessageIds.set(effectiveSessionId, sent.messageId);
            // Persist mapping if needed
            if (targetAgentName) {
                await this._setMessageAgent(sent.messageId, targetAgentName);
            }
        }
    }
}

/**
 * @param {import('../interfaces/index.js').BarkEvent} event
 */
    _onStreamChunk(event) {
        if (this.finishedSessions.has(event.sessionId)) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;
        r.adapter.sendChunk(r.replyTo, event.chunk).catch(err =>
            this.logger.error(`[MessageRouter] Failed to route sendChunk to adapter '${r.adapterName}':`, err)
        );
    }

    _onStreamProgress(event) {
        if (!event.progressText) return;
        if (this.finishedSessions.has(event.sessionId)) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        const messageId = this.liveMessageIds.get(event.sessionId);
        if (!messageId) return;

        // Always buffer the latest progress text — the timer will flush it
        this.pendingProgress.set(event.sessionId, event.progressText);

        // Start flush timer on first event for this session
        if (!this.progressTimers.has(event.sessionId)) {
            const intervalMs = r.adapter.editThrottleMs ?? 2000;
            // Fire immediately for the very first update
            this._flushProgress(event.sessionId);
            const timer = setInterval(() => this._flushProgress(event.sessionId), intervalMs);
            this.progressTimers.set(event.sessionId, timer);
        }
    }

    _flushProgress(sessionId) {
        const progressText = this.pendingProgress.get(sessionId);
        if (!progressText) return;

        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;

        const messageId = this.liveMessageIds.get(sessionId);
        if (!messageId) {
            this._clearProgressTimer(sessionId);
            return;
        }

        // Animated dots: cycles through . .. ...
        const count = (this.flushCount.get(sessionId) || 0) + 1;
        this.flushCount.set(sessionId, count);
        const dots = '.'.repeat((count % 3) + 1);

        // Elapsed time since thinking started
        const startTime = this.thinkingStartTime.get(sessionId);
        const elapsed = startTime ? Math.round((Date.now() - startTime) / 1000) : 0;
        const elapsedLabel = elapsed >= 5 ? ` (${elapsed}s)` : '';

        const prefix = this._getAgentPrefix(sessionId);
        const label = prefix ? prefix.trimEnd() + ` _on it${dots}_${elapsedLabel}` : `_on it${dots}_${elapsedLabel}`;
        const editPromise = r.adapter.editMessage(r.replyTo, messageId, label + '\n\n' + progressText).catch(() => {});
        this.inFlightEdits.set(sessionId, editPromise);
    }

    _clearProgressTimer(sessionId) {
        const timer = this.progressTimers.get(sessionId);
        if (timer) {
            clearInterval(timer);
            this.progressTimers.delete(sessionId);
        }
        this.pendingProgress.delete(sessionId);
        this.flushCount.delete(sessionId);
        this.thinkingStartTime.delete(sessionId);
        // Note: inFlightEdits is NOT deleted here — _editOrSend awaits it before final edit
    }

    async _onDriverComplete(event) {
        if (event.result == null) return;

        // Suppress late completions for sessions already finalized (timeout/error/kill)
        if (this.finishedSessions.has(event.sessionId)) {
            this.finishedSessions.delete(event.sessionId);
            return;
        }

        // Persist driver state if returned by the driver
        if (event.driverState) {
            const storage = this.registry.getStorage();
            if (storage) {
                const session = await storage.getSession(event.sessionId).catch(() => null);
                if (session) {
                    session.driverState = event.driverState;
                    await storage.saveSession(event.sessionId, session).catch(() => {});
                }
            }
        }

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
            this.logger.error('[MessageRouter] No storage plugin registered. Cannot process message.');
            this.eventBus.publish({ type: EventTypes.ERROR_OCCURRED, sessionId, error: new Error('No storage plugin') });
            return;
        }

        // Store routing info for this session so responses go back to the right adapter
        this.sessionRouting.set(sessionId, { adapterName, lastMessageId: event.rawId });

        try {
            // 1. Check for commands
            if (typeof payload === 'string') {
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
            }

            // 2. Routing Detection (Mentions vs Replies)
            const { 
                targetAgentName, 
                targetDriverName, 
                targetSystemPrompt, 
                targetModel, 
                targetPayload 
            } = await this._resolveRouting(event);

            if (typeof payload === 'string' && payload.trim().startsWith('@') && !targetAgentName) {
                // If it looks like a mention but no agent found, it might be an unknown agent
                const parts = payload.trim().split(/\s+/);
                const rawName = parts[0].substring(1);
                await this._replyToSender(sessionId, `❓ Unknown agent: @${rawName}`);
                return;
            }

            if (targetAgentName && typeof targetPayload === 'string' && !targetPayload.trim()) {
                 const prefix = this._getAgentPrefix(targetAgentName + ':' + sessionId);
                 await this._replyToSender(sessionId, `${prefix}I am listening! What would you like to ask?`);
                 return;
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
                this.logger.error(`[MessageRouter] Driver '${session.driverName}' not found.`);
                await this._replyToSender(sessionId, `❌ Driver '${session.driverName}' not found.`);
                return;
            }

            // 4. Send thinking placeholder (or update existing one)
            const routing = this.sessionRouting.get(effectiveSessionId);
            if (routing) {
                const adapter = this.registry.getAdapter(routing.adapterName);
                const replyTo = routing.replyTo || effectiveSessionId;
                if (adapter) {
                    const prefix = this._getAgentPrefix(effectiveSessionId);
                    const thinkingLabel = prefix
                        ? prefix.trimEnd() + ' _on it._'
                        : '_on it._';
                    
                    const existingMessageId = this.liveMessageIds.get(effectiveSessionId);
                    if (existingMessageId) {
                        // Edit the existing "listening" or "processing" message
                        await adapter.editMessage(replyTo, existingMessageId, thinkingLabel).catch(() => {});
                        this.thinkingStartTime.set(effectiveSessionId, Date.now());
                    } else {
                        const sent = await adapter.sendMessage(replyTo, thinkingLabel, { replyToMessageId: routing.lastMessageId }).catch(() => null);
                        if (sent?.messageId) {
                            this.liveMessageIds.set(effectiveSessionId, sent.messageId);
                            this.thinkingStartTime.set(effectiveSessionId, Date.now());
                            if (targetAgentName) {
                                await this._setMessageAgent(sent.messageId, targetAgentName);
                            }
                        }
                    }
                }
            }

            // 5. Run driver with timeout
            this.eventBus.publish({ type: EventTypes.DRIVER_THINKING, sessionId: effectiveSessionId });

            try {
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(Object.assign(
                        new Error('⏱️ No response after 30 minutes. The session was cancelled.'),
                        { isTimeout: true }
                    )), DRIVER_TIMEOUT_MS)
                );
                await Promise.race([
                    driver.sendCommand(effectiveSessionId, targetPayload, targetSystemPrompt, targetModel, session.driverState || {}),
                    timeoutPromise
                ]);
            } catch (driverError) {
                // "Session killed" is expected during restart/stop — don't surface it
                if (driverError.message === 'Session killed') {
                    this.finishedSessions.add(effectiveSessionId);
                    this.liveMessageIds.delete(effectiveSessionId);
                    this._clearProgressTimer(effectiveSessionId);
                    return;
                }

                // Mark session as finished so late driver.complete is suppressed
                this.finishedSessions.add(effectiveSessionId);

                if (driverError.isTimeout) {
                    await driver.kill(effectiveSessionId).catch(() => {});
                } else {
                    this.logger.error(`[MessageRouter] Driver error for session ${effectiveSessionId}:`, driverError);
                }
                await this._editOrSend(effectiveSessionId, `❌ ${driverError.message}`);
            }

        } catch (error) {
            this.logger.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: EventTypes.ERROR_OCCURRED, sessionId, error });
            await this._replyToSender(sessionId, `❌ ${error.message}`);
        }
    }
}
