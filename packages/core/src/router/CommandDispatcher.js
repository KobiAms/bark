export class CommandDispatcher {
    constructor(registry, eventBus) {
        this.registry = registry;
        this.eventBus = eventBus;
    }

    async dispatch(sessionId, payload, adapterName, targetAgentName = null) {
        if (typeof payload !== 'string') return { handled: false };

        for (const command of this.registry.getAllCommands()) {
            if (command.match(payload)) {
                const storage = this.registry.getStorage();
                const result = await command.execute({
                    sessionId,
                    payload,
                    adapterName,
                    targetAgentName,
                    registry: this.registry,
                    eventBus: this.eventBus,
                    storage
                });
                return { handled: true, result };
            }
        }
        return { handled: false };
    }
}
