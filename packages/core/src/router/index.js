export class MessageRouter {
    /**
     * @param {import('../bus/index.js').EventBus} eventBus 
     * @param {import('../registry/index.js').ExtensionRegistry} registry 
     */
    constructor(eventBus, registry) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.defaultDriverName = null;
    }

    setDefaultDriver(name) {
        this.defaultDriverName = name;
    }

    start() {
        this.unsubscribeMessageListener = this.eventBus.subscribe('message.received', async (event) => {
            await this.handleIncomingMessage(event);
        });
    }

    stop() {
        if (this.unsubscribeMessageListener) {
            this.unsubscribeMessageListener();
        }
    }

    /**
     * @param {import('../interfaces/index.js').BarkEvent} event 
     */
    async handleIncomingMessage(event) {
        const { sessionId, payload } = event;
        const storage = this.registry.getStorage();

        if (!storage) {
            console.error('[MessageRouter] No storage plugin registered. Cannot process message.');
            this.eventBus.publish({ type: 'error.occurred', sessionId, error: new Error('No storage plugin') });
            return;
        }

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
                    return; // Command handled it
                }
            }

            // 2. Routing Detection (Mentions vs Replies)
            let targetPayload = payload;
            let targetAgentName = null;
            let targetDriverName = this.defaultDriverName;
            let targetSystemPrompt = null;
            
            const agentRegistry = this.registry.getAgentRegistry();
            const trimmedPayload = typeof payload === 'string' ? payload.trim() : '';

            // A. Check for Reply-To Routing First
            if (agentRegistry && event.quotedMessageMetadata && event.quotedMessageMetadata.senderName) {
                const quotedName = event.quotedMessageMetadata.senderName;
                const agent = await agentRegistry.getAgent(quotedName);
                if (agent) {
                    targetAgentName = quotedName;
                    targetDriverName = agent.driver;
                    targetSystemPrompt = agent.systemPrompt;
                    // Keep the entire payload since the user didn't mention, they just replied
                    targetPayload = trimmedPayload; 
                }
            }

            // B. Fallback to Mention Detection (@name) if not a confirmed reply
            if (!targetAgentName && trimmedPayload.startsWith('@')) {
                const parts = trimmedPayload.split(/\s+/);
                const rawName = parts[0].substring(1); // Remove '@'
                
                if (agentRegistry) {
                    const agent = await agentRegistry.getAgent(rawName);
                    if (agent) {
                        targetAgentName = rawName;
                        targetDriverName = agent.driver;
                        targetSystemPrompt = agent.systemPrompt;
                        
                        // Extract remaining text after @name
                        const nameIndex = payload.indexOf('@' + rawName);
                        targetPayload = payload.substring(nameIndex + rawName.length + 1).trim();

                        if (!targetPayload) {
                            this.eventBus.publish({ 
                                type: 'stream.chunk', 
                                sessionId, 
                                chunk: `🤖 @${rawName} is listening! What would you like to ask?` 
                            });
                            return;
                        }
                    } else {
                        this.eventBus.publish({ 
                            type: 'stream.chunk', 
                            sessionId, 
                            chunk: `❓ Unknown agent: @${rawName}` 
                        });
                        return;
                    }
                }
            }

            // 3. State & Session Management
            const effectiveSessionId = targetAgentName ? `${targetAgentName}:${sessionId}` : sessionId;

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
            // Always use the latest system prompt from the registry if it was a mention,
            // otherwise use whatever the driver was initialized with.
            await driver.sendCommand(effectiveSessionId, targetPayload, targetSystemPrompt);

        } catch (error) {
            console.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: 'error.occurred', sessionId, error });
        }
    }
}
