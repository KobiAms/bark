import { IAdapter, IDriver, IStorage, IAgentRegistry, ICommand } from '../interfaces/index.js';

/**
 * Manages all registered Extensions for the Bark core.
 * Extentsion include Adapters, Drivers, Storage Plugins, and Commands.
 */
export class ExtensionRegistry {
    constructor() {
        this.adapters = new Map();   // name -> IAdapter
        this.drivers = new Map();    // name -> IDriver
        this.commands = new Set();   // ICommand[]
        this.storagePlugin = null;   // IStorage
        this.agentRegistry = null;   // IAgentRegistry
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
        this._assertImplements(adapter, ['start', 'stop', 'sendMessage', 'onMessage', 'onError'], `Adapter '${name}'`);
        
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
        this._assertImplements(driver, ['spawn', 'sendCommand', 'kill', 'onStream', 'onError', 'onComplete'], `Driver '${name}'`);

        if (this.drivers.has(name)) {
            throw new Error(`Driver '${name}' is already registered.`);
        }
        this.drivers.set(name, driver);
    }

    /**
     * @param {IStorage} storage 
     */
    registerStorage(storage) {
        this._assertImplements(storage, ['getSession', 'saveSession'], `Storage plugin`);

        if (this.storagePlugin) {
            console.warn(`[ExtensionRegistry] Overwriting existing Storage plugin.`);
        }
        this.storagePlugin = storage;
    }

    /**
     * @param {IAgentRegistry} registry 
     */
    registerAgentRegistry(registry) {
        this._assertImplements(registry, ['getAgent', 'saveAgent', 'deleteAgent', 'listAgents'], `Agent registry`);

        if (this.agentRegistry) {
            console.warn(`[ExtensionRegistry] Overwriting existing Agent registry.`);
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

    getAdapter(name) { return this.adapters.get(name); }
    getAllAdapters() { return Array.from(this.adapters.values()); }
    
    getDriver(name) { return this.drivers.get(name); }
    getAllDrivers() { return Array.from(this.drivers.values()); }

    getStorage() { return this.storagePlugin; }
    getAgentRegistry() { return this.agentRegistry; }
    getAllCommands() { return Array.from(this.commands); }
}

export const defaultExtensionRegistry = new ExtensionRegistry();
