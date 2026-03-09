import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageRouter } from '../src/router/index.js';
import { EventBus } from '../src/bus/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';

describe('MessageRouter', () => {
    let router, eventBus, registry;
    let mockAdapter, mockDriver, mockStorage;

    beforeEach(() => {
        eventBus = new EventBus();
        registry = new ExtensionRegistry();
        router = new MessageRouter(eventBus, registry);

        // Mock adapter
        mockAdapter = {
            sendMessage: vi.fn().mockResolvedValue({ messageId: 'msg123' }),
            editMessage: vi.fn().mockResolvedValue(undefined),
            sendChunk: vi.fn().mockResolvedValue(undefined),
            announce: vi.fn().mockResolvedValue(undefined),
            onMessage: vi.fn(),
            onError: vi.fn()
        };

        // Mock driver
        mockDriver = {
            spawn: vi.fn().mockResolvedValue(undefined),
            sendCommand: vi.fn().mockResolvedValue(undefined),
            kill: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            onStream: vi.fn(),
            onProgress: vi.fn(),
            onError: vi.fn(),
            onComplete: vi.fn()
        };

        // Mock storage
        mockStorage = {
            getSession: vi.fn().mockResolvedValue(null),
            saveSession: vi.fn().mockResolvedValue(undefined),
            deleteSession: vi.fn().mockResolvedValue(undefined),
            deleteSessionsByPrefix: vi.fn().mockResolvedValue(undefined)
        };

        registry.registerAdapter('test', mockAdapter);
        registry.registerDriver('test-driver', mockDriver);
        registry.registerStorage(mockStorage);
        router.setDefaultDriver('test-driver');
        router.start();
    });

    afterEach(() => {
        router.stop();
    });

    it('should route incoming messages to the driver', async () => {
        const event = {
            type: 'message.received',
            sessionId: 'user123',
            adapterName: 'test',
            payload: 'hello'
        };

        eventBus.publish(event);
        await new Promise(r => setTimeout(r, 50));

        expect(mockDriver.sendCommand).toHaveBeenCalled();
    });

    it('should store session routing info', async () => {
        const event = {
            type: 'message.received',
            sessionId: 'user123',
            adapterName: 'test',
            payload: 'hello'
        };

        eventBus.publish(event);
        await new Promise(r => setTimeout(r, 50));

        const routing = router.sessionRouting.get('user123');
        expect(routing).toBeDefined();
        expect(routing.adapterName).toBe('test');
    });

    it('should send thinking placeholder', async () => {
        const event = {
            type: 'message.received',
            sessionId: 'user123',
            adapterName: 'test',
            payload: 'hello'
        };

        eventBus.publish(event);
        await new Promise(r => setTimeout(r, 50));

        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
            'user123',
            expect.stringContaining('thinking'),
            expect.any(Object)
        );
    });

    it('should handle stream chunks', async () => {
        eventBus.publish({
            type: 'stream.chunk',
            sessionId: 'test_session',
            chunk: 'hello'
        });

        await new Promise(r => setTimeout(r, 50));
        // Stream chunks should be forwarded to adapter if there's a live message
    });

    it('should handle progress updates with throttling', async () => {
        // Set up live message
        router.liveMessageIds.set('test_session', 'msg123');
        router.sessionRouting.set('test_session', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'test_session',
            progressText: 'thinking...'
        });

        await new Promise(r => setTimeout(r, 50));

        // First update should be sent
        expect(mockAdapter.editMessage).toHaveBeenCalled();

        // Second update immediately should be throttled
        mockAdapter.editMessage.mockClear();
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'test_session',
            progressText: 'still thinking...'
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    it('should complete and cleanup on driver.complete', async () => {
        router.liveMessageIds.set('test_session', 'msg123');
        router.sessionRouting.set('test_session', { adapterName: 'test' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'test_session',
            result: 'done'
        });

        await new Promise(r => setTimeout(r, 50));

        expect(router.liveMessageIds.has('test_session')).toBe(false);
        expect(mockAdapter.sendMessage).toHaveBeenCalled();
    });

    it('should handle command.complete events', async () => {
        eventBus.publish({
            type: 'command.complete',
            sessionId: 'user123',
            adapterName: 'test',
            result: 'command result'
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
            'user123',
            'command result',
            expect.any(Object)
        );
    });

    it('should support agent prefix in session routing', async () => {
        const event = {
            type: 'message.received',
            sessionId: 'user123',
            adapterName: 'test',
            payload: '@myagent hello'
        };

        eventBus.publish(event);
        await new Promise(r => setTimeout(r, 50));

        const routing = router.sessionRouting.get('myagent:user123');
        expect(routing).toBeDefined();
        expect(routing.replyTo).toBe('user123');
    });
});
