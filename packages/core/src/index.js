export * from './interfaces/index.js';
export { EventBus, defaultEventBus } from './bus/index.js';
export { ExtensionRegistry, defaultExtensionRegistry } from './registry/index.js';
export { MessageRouter } from './router/index.js';

/**
 * Bark Core Application class.
 * Provides a clean API to initialize the thin-core.
 */
import { EventBus } from './bus/index.js';
import { ExtensionRegistry } from './registry/index.js';
import { MessageRouter } from './router/index.js';
import { LifecycleManager } from './lifecycle/index.js';

export class BarkCore {
    constructor() {
        this.eventBus = new EventBus();
        this.registry = new ExtensionRegistry();
        this.router = new MessageRouter(this.eventBus, this.registry);
        this.lifecycle = new LifecycleManager(this.eventBus, this.registry, this.router);
    }

    /**
     * Attach a new Adapter plugin.
     * @param {string} name 
     * @param {import('./interfaces/index.js').IAdapter} adapter 
     */
    useAdapter(name, adapter) {
        this.registry.registerAdapter(name, adapter);
        
        // Wire adapter events to the bus
        adapter.onMessage((barkEvent) => this.eventBus.publish(barkEvent));
        adapter.onError((error) => console.error(`[Adapter Error: ${name}]`, error));

        // Let adapters listen to stream chunks directly if preferred, or we handle it globally if needed.
        // For bidirectional streaming, we let adapters hook into the bus directly.
        
        return this;
    }

    /**
     * Attach a new Driver plugin.
     * @param {string} name 
     * @param {import('./interfaces/index.js').IDriver} driver 
     */
    useDriver(name, driver) {
        this.registry.registerDriver(name, driver);
        
        // Wire driver events to the bus
        driver.onStream((streamEvent) => {
            this.eventBus.publish({ type: 'stream.chunk', ...streamEvent });
        });
        
        driver.onError((error) => console.error(`[Driver Error: ${name}]`, error));
        driver.onComplete((compEvent) => {
            this.eventBus.publish({ type: 'driver.complete', ...compEvent });
        });

        return this;
    }

    /**
     * Attach a Storage plugin.
     * @param {import('./interfaces/index.js').IStorage} storage 
     */
    useStorage(storage) {
        this.registry.registerStorage(storage);
        return this;
    }

    /**
     * Attach an Agent Registry plugin.
     * @param {import('./interfaces/index.js').IAgentRegistry} registry 
     */
    useAgentRegistry(registry) {
        this.registry.registerAgentRegistry(registry);
        return this;
    }

    /**
     * Attach a Command plugin.
     * @param {import('./interfaces/index.js').ICommand} command 
     */
    useCommand(command) {
        this.registry.registerCommand(command);
        return this;
    }

    /**
     * Start the orchestration layer.
     */
    async start() {
        await this.lifecycle.start();
    }

    /**
     * Stop the orchestration layer.
     */
    async stop() {
        await this.lifecycle.stop();
    }
}
