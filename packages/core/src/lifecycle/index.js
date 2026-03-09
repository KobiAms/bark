export class LifecycleManager {
    /**
     * @param {import('../bus/index.js').EventBus} eventBus 
     * @param {import('../registry/index.js').ExtensionRegistry} registry 
     * @param {import('../router/index.js').MessageRouter} router
     */
    constructor(eventBus, registry, router) {
        this.eventBus = eventBus;
        this.registry = registry;
        this.router = router;
        this.isStarted = false;
    }

    /**
     * Start the orchestration layer.
     * Initializes the router and all registered adapters.
     * @returns {Promise<void>}
     */
    async start() {
        if (this.isStarted) return;
        
        console.log('[LifecycleManager] Starting Bark Core...');
        this.router.start();
        
        const adapters = this.registry.getAllAdapters();
        const startPromises = adapters.map(adapter => adapter.start().catch(err => {
            console.error('[LifecycleManager] Failed to start adapter:', err);
        }));

        await Promise.all(startPromises);
        this.isStarted = true;
        
        this.eventBus.publish({
            type: 'core.started',
            sessionId: 'system',
            timestamp: new Date()
        });
        console.log('[LifecycleManager] Bark Core started.');
    }

    /**
     * Stop the orchestration layer.
     * Gracefully disconnects adapters and kills active driver sessions.
     * @returns {Promise<void>}
     */
    async stop() {
        if (!this.isStarted) return;

        console.log('[LifecycleManager] Stopping Bark Core...');
        this.router.stop();
        
        const adapters = this.registry.getAllAdapters();
        const stopPromises = adapters.map(adapter => adapter.stop().catch(err => {
            console.error('[LifecycleManager] Failed to stop adapter:', err);
        }));

        const drivers = this.registry.getAllDrivers();
        const stopDriverPromises = drivers.map(driver => driver.stop().catch(err => {
            console.error('[LifecycleManager] Failed to stop driver:', err);
        }));

        await Promise.all([...stopPromises, ...stopDriverPromises]);
        this.isStarted = false;

        this.eventBus.publish({
            type: 'core.stopped',
            sessionId: 'system',
            timestamp: new Date()
        });
        console.log('[LifecycleManager] Bark Core stopped.');
    }
}
