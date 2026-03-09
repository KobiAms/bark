import { describe, it, expect } from 'vitest';
import { ExtensionRegistry } from '../src/registry/index.js';

describe('ExtensionRegistry', () => {
    it('should throw if adapter lacks required methods', () => {
        const registry = new ExtensionRegistry();
        const invalidAdapter = { start: () => {} }; // Missing stop, onMessage, etc.
        
        expect(() => {
            registry.registerAdapter('test', invalidAdapter);
        }).toThrow(/Validation Error: Adapter 'test' is missing required method 'stop'/);
    });

    it('should register a valid adapter', () => {
        const registry = new ExtensionRegistry();
        const validAdapter = {
            start: () => {}, stop: () => {}, sendMessage: () => {}, onMessage: () => {}, onError: () => {}
        };
        
        expect(() => {
            registry.registerAdapter('valid-adapter', validAdapter);
        }).not.toThrow();
        
        expect(registry.getAdapter('valid-adapter')).toBe(validAdapter);
    });

    it('should throw an error when registering a duplicate driver name', () => {
        const registry = new ExtensionRegistry();
        const validDriver = {
            spawn: () => {}, sendCommand: () => {}, kill: () => {}, onStream: () => {}, onError: () => {}, onComplete: () => {}
        };
        
        registry.registerDriver('dup-driver', validDriver);
        
        expect(() => {
            registry.registerDriver('dup-driver', validDriver);
        }).toThrow(/Driver 'dup-driver' is already registered/);
    });
});
