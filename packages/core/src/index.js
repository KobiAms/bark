export * from './interfaces/index.js';
export { EventBus } from './bus/index.js';
export { ExtensionRegistry } from './registry/index.js';
export { MessageRouter } from './router/index.js';
export { ConsoleLogger } from './logger/index.js';

/**
 * Bark Core Application class.
 * Provides a clean API to initialize the thin-core.
 */
import { EventBus } from './bus/index.js';
import { ExtensionRegistry } from './registry/index.js';
import { MessageRouter } from './router/index.js';
import { LifecycleManager } from './lifecycle/index.js';
import { EventTypes } from './interfaces/index.js';
import { ConsoleLogger } from './logger/index.js';

export class BarkCore {
    constructor() {
        this.eventBus = new EventBus();
        this.logger = new ConsoleLogger();
        this.registry = new ExtensionRegistry(this.logger);
        this.router = new MessageRouter(this.eventBus, this.registry, this.logger);
        this.lifecycle = new LifecycleManager(this.eventBus, this.registry, this.router, this.logger);
    }

    /**
     * Attach a new Adapter plugin.
     * @param {string} name 
     * @param {import('./interfaces/index.js').IAdapter} adapter 
     */
    useAdapter(name, adapter) {
        this.registry.registerAdapter(name, adapter);
        adapter.setLogger(this.logger);

        // Wire adapter events to the bus, stamping adapterName so the router knows where to reply
        adapter.onMessage((barkEvent) => this.eventBus.publish({ adapterName: name, ...barkEvent }));
        adapter.onError((error) => this.logger.error(`[Adapter Error: ${name}]`, error));

        return this;
    }

    /**
     * Attach a new Driver plugin.
     * @param {string} name 
     * @param {import('./interfaces/index.js').IDriver} driver 
     */
    useDriver(name, driver) {
        this.registry.registerDriver(name, driver);
        driver.setLogger(this.logger);

        // Wire driver events to the bus
        driver.onStream((streamEvent) => {
            this.eventBus.publish({ type: EventTypes.STREAM_CHUNK, ...streamEvent });
        });

        driver.onProgress((progressEvent) => {
            this.eventBus.publish({ type: EventTypes.STREAM_PROGRESS, ...progressEvent });
        });

        driver.onError((error) => this.logger.error(`[Driver Error: ${name}]`, error));
        driver.onComplete((compEvent) => {
            this.eventBus.publish({ type: EventTypes.DRIVER_COMPLETE, ...compEvent });
        });

        return this;
    }

    /**
     * Attach a Storage plugin.
     * @param {import('./interfaces/index.js').IStorage} storage 
     */
    useStorage(storage) {
        this.registry.registerStorage(storage);
        storage.setLogger(this.logger);
        return this;
    }

    /**
     * Attach an Agent Registry plugin.
     * @param {import('./interfaces/index.js').IAgentRegistry} registry 
     */
    useAgentRegistry(registry) {
        this.registry.registerAgentRegistry(registry);
        registry.setLogger(this.logger);
        return this;
    }

    /**
     * Attach a Command plugin.
     * @param {import('./interfaces/index.js').ICommand} command
     */
    useCommand(command) {
        this.registry.registerCommand(command);
        command.setLogger(this.logger);
        return this;
    }

    /**
     * Attach an EventBus plugin.
     * Plugins subscribe to namespaced events and publish transformed events.
     * Register all plugins before calling start() — they are wired during lifecycle.start().
     * @param {import('./interfaces/index.js').IPlugin} plugin
     */
    usePlugin(plugin) {
        this.registry.registerPlugin(plugin);
        plugin.setLogger(this.logger);
        return this;
    }

    useLogger(logger) {
        this.logger = logger;
        return this;
    }

    /**
     * Determine the terminal event type the router should subscribe to.
     * Walks the registered message.received plugin chain and returns the last outputEvent.
     * Falls back to 'message.received' if no message plugins are registered.
     * @private
     */
    _computeRouterInputEvent() {
        const messagePlugins = this.registry.getAllPlugins().filter(p =>
            p.inputEvent === 'message.received' || p.inputEvent.startsWith('message.received.')
        );
        if (messagePlugins.length === 0) return 'message.received';
        return messagePlugins[messagePlugins.length - 1].outputEvent;
    }

    /**
     * Start the orchestration layer.
     */
    async start() {
        this.router.setInputEvent(this._computeRouterInputEvent());
        await this.lifecycle.start();
    }

    /**
     * Stop the orchestration layer.
     */
    async stop() {
        await this.lifecycle.stop();
    }
}
