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

            // 2. State & Session Management
            let session = await storage.getSession(sessionId);
            if (!session) {
                const availableDrivers = Array.from(this.registry.drivers.keys());
                session = {
                    sessionId,
                    driverName: this.defaultDriverName || availableDrivers[0]
                };
                await storage.saveSession(sessionId, session);
            }

            const driverName = session.driverName;
            const driver = this.registry.getDriver(driverName);

            if (!driver) {
                console.error(`[MessageRouter] Driver '${driverName}' not found.`);
                this.eventBus.publish({ type: 'error.occurred', sessionId, error: new Error(`Driver ${driverName} not found`) });
                return;
            }

            // 3. Route to Driver
            await driver.sendCommand(sessionId, payload);

        } catch (error) {
            console.error(`[MessageRouter] Error processing message for session ${sessionId}:`, error);
            this.eventBus.publish({ type: 'error.occurred', sessionId, error });
        }
    }
}
