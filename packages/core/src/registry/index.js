import { IAdapter, IDriver, IStorage, IAgentRegistry, ICommand, IPlugin } from '../interfaces/index.js';
import { defaultLogger } from '../logger/index.js';

/**
 * Manages all registered Extensions for the Bark core.
 * Extentsion include Adapters, Drivers, Storage Plugins, and Commands.
 */
export class ExtensionRegistry {
    constructor(logger = defaultLogger) {
        this.adapters = new Map();   // name -> IAdapter
        this.drivers = new Map();    // name -> IDriver
        this.commands = new Set();   // ICommand[]
        this.plugins = [];           // IPlugin[] ordered by registration
        this.storagePlugin = null;   // IStorage
        this.agentRegistry = null;   // IAgentRegistry
        this.logger = logger;
    }

    _assertImplements(instance, methods, name) {
        for (const method of methods) {
            if (typeof instance[method] !== 'function') {
                throw new Error(`[ExtensionRegistry] Validation Error: ${name} is missing required method '${method}'.`);
            }
        }
    }

    /**
     * @param {string} name 
     * @param {IAdapter} adapter 
     */
    registerAdapter(name, adapter) {
        this._assertImplements(adapter, ['start', 'stop', 'sendMessage', 'editMessage', 'sendChunk', 'announce', 'onMessage', 'onError'], `Adapter '${name}'`);

        if (this.adapters.has(name)) {
            throw new Error(`Adapter '${name}' is already registered.`);
        }
        this.adapters.set(name, adapter);
    }

    /**
     * @param {string} name 
     * @param {IDriver} driver 
     */
    registerDriver(name, driver) {
        this._assertImplements(driver, ['spawn', 'sendCommand', 'kill', 'stop', 'onStream', 'onProgress', 'onError', 'onComplete'], `Driver '${name}'`);

        if (this.drivers.has(name)) {
            throw new Error(`Driver '${name}' is already registered.`);
        }
        this.drivers.set(name, driver);
    }

    /**
     * @param {IStorage} storage 
     */
    registerStorage(storage) {
        this._assertImplements(storage, ['getSession', 'saveSession', 'deleteSession', 'deleteSessionsByPrefix'], `Storage plugin`);

        if (this.storagePlugin) {
            this.logger.warn(`[ExtensionRegistry] Overwriting existing Storage plugin.`);
        }
        this.storagePlugin = storage;
    }

    /**
     * @param {IAgentRegistry} registry 
     */
    registerAgentRegistry(registry) {
        this._assertImplements(registry, ['getAgent', 'saveAgent', 'deleteAgent', 'listAgents'], `Agent registry`);

        if (this.agentRegistry) {
            this.logger.warn(`[ExtensionRegistry] Overwriting existing Agent registry.`);
        }
        this.agentRegistry = registry;
    }

    /**
     * @param {ICommand} command
     */
    registerCommand(command) {
        this._assertImplements(command, ['match', 'execute'], `Command plugin`);
        this.commands.add(command);
    }

    /**
     * @param {IPlugin} plugin
     */
    registerPlugin(plugin) {
        this._assertImplements(plugin, ['register', 'stop'], `Plugin`);
        if (typeof plugin.inputEvent !== 'string' || typeof plugin.outputEvent !== 'string') {
            throw new Error(`[ExtensionRegistry] Plugin must declare string inputEvent and outputEvent getters.`);
        }
        this.plugins.push(plugin);
    }

    getAdapter(name) { return this.adapters.get(name); }
    getAllAdapters() { return Array.from(this.adapters.values()); }
    
    getDriver(name) { return this.drivers.get(name); }
    getAllDrivers() { return Array.from(this.drivers.values()); }

    getStorage() { return this.storagePlugin; }
    getAgentRegistry() { return this.agentRegistry; }
    getAllCommands() { return Array.from(this.commands); }
    getAllPlugins() { return [...this.plugins]; }
}

