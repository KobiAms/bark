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
        await Promise.all(adapters.map(adapter => adapter.start().catch(err => {
            console.error('[LifecycleManager] Failed to start adapter:', err);
        })));

        this.isStarted = true;

        this.eventBus.publish({ type: 'core.started', sessionId: 'system', timestamp: new Date() });
        console.log('[LifecycleManager] Bark Core started.');

        // Edit any pending restart messages; returns the adapterName that was edited (if any)
        const editedAdapterName = await this._editPendingRestarts();

        // Announce to adapters that didn't already receive the restart edit
        await Promise.all(
            Array.from(this.registry.adapters.entries())
                .filter(([name]) => name !== editedAdapterName)
                .map(([, adapter]) => adapter.announce('✅ Bark Core is online!').catch(() => {}))
        );
    }

    /**
     * Edit any messages left pending from a restart command.
     * @private
     */
    async _editPendingRestarts() {
        const storage = this.registry.getStorage();
        if (!storage) return null;

        try {
            const pendingData = await storage.getSession('__restart_pending__').catch(() => null);
            if (!pendingData?.adapterName || !pendingData?.messageId) return null;

            await storage.deleteSession('__restart_pending__').catch(() => {});

            const adapter = this.registry.getAdapter(pendingData.adapterName);
            if (adapter) {
                await adapter.editMessage(pendingData.sessionId, pendingData.messageId, '✅ Bark Core is online!').catch(err => {
                    console.error('[LifecycleManager] Failed to edit restart message:', err);
                    return null;
                });
                return pendingData.adapterName;
            }
        } catch (err) {
            console.error('[LifecycleManager] Error processing pending restarts:', err);
        }
        return null;
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
