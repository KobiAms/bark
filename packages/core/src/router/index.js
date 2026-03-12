import { EventTypes } from '../interfaces/index.js';
import { defaultLogger } from '../logger/index.js';
import { ProgressFormatter } from './ProgressFormatter.js';
import { CommandDispatcher } from './CommandDispatcher.js';

const DRIVER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const EDIT_THROTTLE_MS = 2000;

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
        this.commandDispatcher = new CommandDispatcher(registry, eventBus);

        // Unified session state Map<sessionId, SessionContext>
        this.contexts = new Map();

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
            this.eventBus.subscribe(EventTypes.COMMAND_COMPLETE,  (event) => this._onCommandComplete(event))
        );
    }

    stop() {
        this._unsubs.forEach(fn => fn());
        this._unsubs = [];
    }

    _getContext(sessionId) {
        if (!this.contexts.has(sessionId)) {
            this.contexts.set(sessionId, {
                adapterName: null,
                replyTo: null,
                lastMessageId: null,
                liveMessageId: null,
                pendingProgress: null,
                progressTimer: null,
                flushCount: 0,
                thinkingStartTime: null,
                inFlightEdit: null,
                streamedText: ''
            });
        }
        return this.contexts.get(sessionId);
    }

    // --- messageToAgent persistence ---

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
        const ctx = this.contexts.get(sessionId);
        if (!ctx || !ctx.adapterName) return null;
        return {
            adapter: this.registry.getAdapter(ctx.adapterName),
            replyTo: ctx.replyTo || sessionId,
            adapterName: ctx.adapterName,
            lastMessageId: ctx.lastMessageId
        };
    }

    async _replyToSender(sessionId, text) {
        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;
        await r.adapter.sendMessage(r.replyTo, text, { replyToMessageId: r.lastMessageId }).catch(err =>
            this.logger.error(`[MessageRouter] Failed to reply to session '${sessionId}':`, err)
        );
    }

    async _editOrSend(effectiveSessionId, text) {
        const r = this._getAdapterAndReplyTo(effectiveSessionId);
        if (!r?.adapter) return null;

        const ctx = this._getContext(effectiveSessionId);
        const messageId = ctx.liveMessageId;
        ctx.liveMessageId = null;
        this._clearProgressTimer(effectiveSessionId);

        if (ctx.inFlightEdit) {
            await ctx.inFlightEdit;
            ctx.inFlightEdit = null;
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
            const ctx = this._getContext(event.sessionId);
            ctx.liveMessageId = sent.messageId;
        }
    }

    async _resolveRouting(event) {
        const { payload } = event;
        const agentRegistry = this.registry.getAgentRegistry();
        const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';

        let targetAgentName = null;
        let targetDriverName = this.defaultDriverName;
        let targetSystemPrompt = null;
        let targetModel = null;
        let targetPayload = payload;

        // A. Mention Detection
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

                    if (event.quotedMessageMetadata?.content) {
                        const quotedSender = event.quotedMessageMetadata.senderName || 'Previous message';
                        targetPayload = `[${quotedSender} said:]\n${event.quotedMessageMetadata.content}\n\n${targetPayload}`;
                    }
                }
            }
        }

        // B. Reply-To Routing
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

        // C. senderName fallback
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

    async handleMediaIndicator(event) {
        if (this.inputEvent === EventTypes.MESSAGE_RECEIVED) return;

        const { sessionId, payload, adapterName } = event;
        if (typeof payload === 'string') return;

        const baseCtx = this._getContext(sessionId);
        baseCtx.adapterName = adapterName;
        baseCtx.lastMessageId = event.rawId;

        const { targetAgentName } = await this._resolveRouting(event);
        const effectiveSessionId = targetAgentName ? `${targetAgentName}:${sessionId}` : sessionId;

        if (targetAgentName) {
            const effCtx = this._getContext(effectiveSessionId);
            effCtx.adapterName = adapterName;
            effCtx.replyTo = sessionId;
            effCtx.lastMessageId = event.rawId;
        }

        const adapter = this.registry.getAdapter(adapterName);
        if (adapter) {
            const prefix = this._getAgentPrefix(effectiveSessionId);
            const label = payload?.type === 'audio' ? '_listening..._' : '_processing..._';
            const placeholder = prefix ? prefix.trimEnd() + ' ' + label : label;

            const sent = await adapter.sendMessage(sessionId, placeholder, { replyToMessageId: event.rawId }).catch(() => null);
            if (sent?.messageId) {
                const effCtx = this._getContext(effectiveSessionId);
                effCtx.liveMessageId = sent.messageId;
                if (targetAgentName) {
                    await this._setMessageAgent(sent.messageId, targetAgentName);
                }
            }
        }
    }

    _onStreamChunk(event) {
        if (this.finishedSessions.has(event.sessionId)) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        r.adapter.sendChunk(r.replyTo, event.chunk).catch(err =>
            this.logger.error(`[MessageRouter] Failed to route sendChunk to adapter '${r.adapterName}':`, err)
        );

        const ctx = this._getContext(event.sessionId);
        ctx.streamedText += event.chunk;

        if (!ctx.progressTimer && ctx.liveMessageId) {
            this._flushProgress(event.sessionId);
            ctx.progressTimer = setInterval(() => this._flushProgress(event.sessionId), EDIT_THROTTLE_MS);
        }
    }

    _onStreamProgress(event) {
        if (!event.progressText) return;
        if (this.finishedSessions.has(event.sessionId)) return;
        const r = this._getAdapterAndReplyTo(event.sessionId);
        if (!r?.adapter) return;

        const ctx = this._getContext(event.sessionId);
        if (!ctx.liveMessageId) return;

        ctx.pendingProgress = event.progressText;

        if (!ctx.progressTimer) {
            this._flushProgress(event.sessionId);
            ctx.progressTimer = setInterval(() => this._flushProgress(event.sessionId), EDIT_THROTTLE_MS);
        }
    }

    _flushProgress(sessionId) {
        const ctx = this._getContext(sessionId);
        if (!ctx.pendingProgress) return;

        const r = this._getAdapterAndReplyTo(sessionId);
        if (!r?.adapter) return;

        if (!ctx.liveMessageId) {
            this._clearProgressTimer(sessionId);
            return;
        }

        ctx.flushCount += 1;
        const body = ProgressFormatter.format({
            prefix: this._getAgentPrefix(sessionId),
            progressText: ctx.pendingProgress,
            streamedText: ctx.streamedText,
            flushCount: ctx.flushCount,
            thinkingStartTime: ctx.thinkingStartTime
        });

        ctx.inFlightEdit = r.adapter.editMessage(r.replyTo, ctx.liveMessageId, body).catch(() => {});
    }

    _clearProgressTimer(sessionId) {
        const ctx = this.contexts.get(sessionId);
        if (ctx) {
            if (ctx.progressTimer) {
                clearInterval(ctx.progressTimer);
                ctx.progressTimer = null;
            }
            ctx.pendingProgress = null;
            ctx.flushCount = 0;
            ctx.thinkingStartTime = null;
            ctx.streamedText = '';
        }
    }

    async _onDriverComplete(event) {
        if (event.result == null) return;

        if (this.finishedSessions.has(event.sessionId)) {
            this.finishedSessions.delete(event.sessionId);
            return;
        }

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

        if (sentMessageId && event.sessionId.includes(':')) {
            const agentName = event.sessionId.split(':')[0];
            const agentRegistry = this.registry.getAgentRegistry();
            const agent = agentRegistry ? await agentRegistry.getAgent(agentName).catch(() => null) : null;
            if (agent) {
                await this._setMessageAgent(sentMessageId, agentName);
            }
        }
    }

    async handleIncomingMessage(event) {
        const { sessionId, payload, adapterName } = event;
        const storage = this.registry.getStorage();

        if (!storage) {
            this.logger.error('[MessageRouter] No storage plugin registered. Cannot process message.');
            return;
        }

        const baseCtx = this._getContext(sessionId);
        baseCtx.adapterName = adapterName;
        baseCtx.lastMessageId = event.rawId;

        try {
            // 1. Check for commands
            const cmd = await this.commandDispatcher.dispatch(sessionId, payload, adapterName);
            if (cmd.handled) {
                if (typeof cmd.result === 'string') {
                    await this._replyToSender(sessionId, cmd.result);
                }
                return;
            }

            // 2. Routing Detection
            const { 
                targetAgentName, 
                targetDriverName, 
                targetSystemPrompt, 
                targetModel, 
                targetPayload 
            } = await this._resolveRouting(event);

            if (typeof payload === 'string' && payload.trim().startsWith('@') && !targetAgentName) {
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
                const effCtx = this._getContext(effectiveSessionId);
                effCtx.adapterName = adapterName;
                effCtx.replyTo = sessionId;
                effCtx.lastMessageId = event.rawId;
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

            // 4. Send thinking placeholder
            const effCtx = this._getContext(effectiveSessionId);
            if (effCtx.adapterName) {
                const adapter = this.registry.getAdapter(effCtx.adapterName);
                const replyTo = effCtx.replyTo || effectiveSessionId;
                if (adapter) {
                    const prefix = this._getAgentPrefix(effectiveSessionId);
                    const thinkingLabel = prefix
                        ? prefix.trimEnd() + ' _on it._'
                        : '_on it._';
                    
                    const existingMessageId = effCtx.liveMessageId;
                    if (existingMessageId) {
                        await adapter.editMessage(replyTo, existingMessageId, thinkingLabel).catch(() => {});
                        effCtx.thinkingStartTime = Date.now();
                    } else {
                        const sent = await adapter.sendMessage(replyTo, thinkingLabel, { replyToMessageId: effCtx.lastMessageId }).catch(() => null);
                        if (sent?.messageId) {
                            effCtx.liveMessageId = sent.messageId;
                            effCtx.thinkingStartTime = Date.now();
                            if (targetAgentName) {
                                await this._setMessageAgent(sent.messageId, targetAgentName);
                            }
                        }
                    }
                }
            }

            // 5. Run driver with timeout
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
                if (driverError.message === 'Session killed') {
                    this.finishedSessions.add(effectiveSessionId);
                    effCtx.liveMessageId = null;
                    this._clearProgressTimer(effectiveSessionId);
                    return;
                }

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
            await this._replyToSender(sessionId, `❌ ${error.message}`);
        }
    }
}