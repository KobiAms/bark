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

            // 2. Mention Detection (@name)
            let targetPayload = payload;
            let targetAgentName = null;
            let targetDriverName = this.defaultDriverName;
            let targetSystemPrompt = null;

            if (typeof payload === 'string' && payload.startsWith('@')) {
                const parts = payload.split(' ');
                const rawName = parts[0].substring(1); // Remove '@'
                const agentRegistry = this.registry.getAgentRegistry();
                
                if (agentRegistry) {
                    const agent = await agentRegistry.getAgent(rawName);
                    if (agent) {
                        targetAgentName = rawName;
                        targetDriverName = agent.driver;
                        targetSystemPrompt = agent.systemPrompt;
                        targetPayload = parts.slice(1).join(' ').trim();
                    } else {
                        // Optional: only notify if it definitely looks like a mention intent
                        // For now, if @name is at start and not found, we warn
                        this.eventBus.publish({ 
                            type: 'stream.chunk', 
                            sessionId, 
                            chunk: `❓ Unknown pup: @${rawName}` 
                        });
                        return;
                    }
                }
            }

            // 3. State & Session Management
            // If mentioned, we use a composite ID for isolation: "agentName:sessionId"
            const effectiveSessionId = targetAgentName ? `${targetAgentName}:${sessionId}` : sessionId;

            let session = await storage.getSession(effectiveSessionId);
            if (!session) {
                const availableDrivers = Array.from(this.registry.drivers.keys());
                session = {
                    sessionId: effectiveSessionId,
                    driverName: targetDriverName || availableDrivers[0],
                    targetSystemPrompt // Carry system prompt for initialization
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
            // If driver supports system prompts, we pass it from the session state
            await driver.sendCommand(effectiveSessionId, targetPayload, session.targetSystemPrompt);

        } catch (error) {
            console.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: 'error.occurred', sessionId, error });
        }
    }
}
