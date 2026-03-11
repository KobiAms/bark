import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MessageRouter } from '../src/router/index.js';
import { EventBus } from '../src/bus/index.js';
import { ExtensionRegistry } from '../src/registry/index.js';

/**
 * Dedicated tests for the thinking/progress stream flow.
 *
 * The thinking stream shows live progress while a driver is working:
 *   1. User sends a message → router sends "_on it._" placeholder
 *   2. Driver emits stream.progress events → router edits the placeholder
 *   3. Progress is throttled (default 2000ms) so only periodic edits fire
 *   4. On driver.complete the placeholder is replaced with the final result
 *
 * These tests verify the full lifecycle — especially relevant for adapters
 * like WhatsApp where editMessage is used for live updates.
 */
describe('Thinking Stream', () => {
    let router, eventBus, registry;
    let mockAdapter, mockDriver, mockStorage;

    beforeEach(() => {
        eventBus = new EventBus();
        registry = new ExtensionRegistry();
        router = new MessageRouter(eventBus, registry);

        mockAdapter = {
            start: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            sendMessage: vi.fn().mockResolvedValue({ messageId: 'placeholder-msg-1' }),
            editMessage: vi.fn().mockResolvedValue(undefined),
            sendChunk: vi.fn().mockResolvedValue(undefined),
            announce: vi.fn().mockResolvedValue(undefined),
            onMessage: vi.fn(),
            onError: vi.fn(),
        };

        mockDriver = {
            spawn: vi.fn().mockResolvedValue(undefined),
            sendCommand: vi.fn().mockResolvedValue(undefined),
            kill: vi.fn().mockResolvedValue(undefined),
            stop: vi.fn().mockResolvedValue(undefined),
            onStream: vi.fn(),
            onProgress: vi.fn(),
            onError: vi.fn(),
            onComplete: vi.fn(),
        };

        mockStorage = {
            getSession: vi.fn().mockResolvedValue(null),
            saveSession: vi.fn().mockResolvedValue(undefined),
            deleteSession: vi.fn().mockResolvedValue(undefined),
            deleteSessionsByPrefix: vi.fn().mockResolvedValue(undefined),
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

    // ----------------------------------------------------------------
    // 1. Placeholder ("_on it._") lifecycle
    // ----------------------------------------------------------------

    it('should send a thinking placeholder when a message arrives', async () => {
        eventBus.publish({
            type: 'message.received',
            sessionId: 'user1',
            adapterName: 'test',
            payload: 'hello',
        });
        await new Promise(r => setTimeout(r, 50));

        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
            'user1',
            expect.stringContaining('on it'),
            expect.any(Object),
        );
    });

    it('should store the placeholder messageId for live editing', async () => {
        eventBus.publish({
            type: 'message.received',
            sessionId: 'user1',
            adapterName: 'test',
            payload: 'hello',
        });
        await new Promise(r => setTimeout(r, 50));

        expect(router.liveMessageIds.get('user1')).toBe('placeholder-msg-1');
    });

    // ----------------------------------------------------------------
    // 2. Progress events → editMessage
    // ----------------------------------------------------------------

    it('should edit the placeholder on first progress event', async () => {
        // Manually set up a live session (simulates post-placeholder state)
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: '_analyzing the code..._',
        });

        await new Promise(r => setTimeout(r, 50));

        // First progress fires immediately
        expect(mockAdapter.editMessage).toHaveBeenCalledWith(
            'sess1',
            'placeholder-msg-1',
            expect.stringContaining('on it'),
        );
    });

    it('should include the progress text in the edit body', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: '_reading files..._\n📖 Read → ✏️ Edit',
        });

        await new Promise(r => setTimeout(r, 50));

        const editCall = mockAdapter.editMessage.mock.calls[0];
        expect(editCall[2]).toContain('reading files');
    });

    it('should throttle rapid progress updates', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        // First progress → fires immediately
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'step 1',
        });
        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).toHaveBeenCalledTimes(1);

        // Second progress within throttle window → should NOT fire
        mockAdapter.editMessage.mockClear();
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'step 2',
        });
        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    it('should flush buffered progress after throttle interval', async () => {
        // Use a short throttle for testing
        mockAdapter.editThrottleMs = 200;
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'step 1',
        });
        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).toHaveBeenCalledTimes(1);

        // Buffer a second update
        mockAdapter.editMessage.mockClear();
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'step 2 — deeper analysis',
        });

        // Wait for the throttle interval to flush
        await new Promise(r => setTimeout(r, 300));
        expect(mockAdapter.editMessage).toHaveBeenCalled();
        const lastCall = mockAdapter.editMessage.mock.calls.at(-1);
        expect(lastCall[2]).toContain('deeper analysis');
    });

    it('should not edit if no live placeholder exists', async () => {
        // No liveMessageIds set
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'thinking...',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    it('should ignore progress events with empty progressText', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: '',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // 3. Stream chunks (text tokens)
    // ----------------------------------------------------------------

    it('should forward stream chunks to adapter via sendChunk', async () => {
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.chunk',
            sessionId: 'sess1',
            chunk: 'Hello ',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.sendChunk).toHaveBeenCalledWith('sess1', 'Hello ');
    });

    it('should ignore chunks with null content', async () => {
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'stream.chunk',
            sessionId: 'sess1',
            chunk: null,
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.sendChunk).not.toHaveBeenCalled();
    });

    // ----------------------------------------------------------------
    // 4. driver.complete → finalize
    // ----------------------------------------------------------------

    it('should edit placeholder with final result on driver.complete', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: 'Here is your answer.',
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockAdapter.editMessage).toHaveBeenCalledWith(
            'sess1',
            'placeholder-msg-1',
            'Here is your answer.',
        );
    });

    it('should clear liveMessageId after driver.complete', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: 'done',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(router.liveMessageIds.has('sess1')).toBe(false);
    });

    it('should clear progress timer after driver.complete', async () => {
        mockAdapter.editThrottleMs = 200;
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        // Start a progress timer
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'working...',
        });
        await new Promise(r => setTimeout(r, 50));
        expect(router.progressTimers.has('sess1')).toBe(true);

        // Complete — should clean up
        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: 'done',
        });
        await new Promise(r => setTimeout(r, 50));

        expect(router.progressTimers.has('sess1')).toBe(false);
        expect(router.pendingProgress.has('sess1')).toBe(false);
        expect(router.flushCount.has('sess1')).toBe(false);
    });

    it('should send a new message if no placeholder exists on complete', async () => {
        // No liveMessageId — should fall through to sendMessage
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: 'answer without placeholder',
        });

        await new Promise(r => setTimeout(r, 50));

        expect(mockAdapter.editMessage).not.toHaveBeenCalled();
        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
            'sess1',
            'answer without placeholder',
            expect.any(Object),
        );
    });

    it('should fall back to "Done." if result is empty', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: '   ',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).toHaveBeenCalledWith(
            'sess1',
            'placeholder-msg-1',
            'Done.',
        );
    });

    // ----------------------------------------------------------------
    // 5. Animated dots in progress labels
    // ----------------------------------------------------------------

    it('should cycle through animated dots on progress flushes', async () => {
        mockAdapter.editThrottleMs = 100;
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        // First progress → immediate flush (count=1 → ".")
        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'sess1',
            progressText: 'analyzing',
        });
        await new Promise(r => setTimeout(r, 50));

        const firstEdit = mockAdapter.editMessage.mock.calls[0][2];
        expect(firstEdit).toMatch(/on it\./);

        // Wait for multiple flushes — dots should cycle
        await new Promise(r => setTimeout(r, 250));
        const calls = mockAdapter.editMessage.mock.calls;
        // Should have at least 2 edits (initial + timer flushes)
        expect(calls.length).toBeGreaterThanOrEqual(2);
        // Each subsequent flush should still contain "on it" with dots
        const lastEdit = calls[calls.length - 1][2];
        expect(lastEdit).toMatch(/on it/);
    });

    // ----------------------------------------------------------------
    // 6. Agent-prefixed sessions (e.g. "myagent:user1")
    // ----------------------------------------------------------------

    it('should prefix progress edits with agent name for agent sessions', async () => {
        router.liveMessageIds.set('myagent:user1', 'placeholder-msg-1');
        router.sessionRouting.set('myagent:user1', { adapterName: 'test', replyTo: 'user1' });

        eventBus.publish({
            type: 'stream.progress',
            sessionId: 'myagent:user1',
            progressText: 'checking...',
        });

        await new Promise(r => setTimeout(r, 50));
        const editText = mockAdapter.editMessage.mock.calls[0][2];
        expect(editText).toContain('*@myagent*');
        expect(editText).toContain('on it');
    });

    it('should prefix final result with agent name on complete', async () => {
        router.liveMessageIds.set('myagent:user1', 'placeholder-msg-1');
        router.sessionRouting.set('myagent:user1', { adapterName: 'test', replyTo: 'user1' });

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'myagent:user1',
            result: 'The answer is 42.',
        });

        await new Promise(r => setTimeout(r, 50));
        expect(mockAdapter.editMessage).toHaveBeenCalledWith(
            'user1',
            'placeholder-msg-1',
            '*@myagent*\n\nThe answer is 42.',
        );
    });

    // ----------------------------------------------------------------
    // 7. End-to-end thinking flow (message → progress → complete)
    // ----------------------------------------------------------------

    it('should handle the full thinking lifecycle: placeholder → progress → complete', async () => {
        // Make the driver emit progress + complete asynchronously
        mockDriver.sendCommand.mockImplementation(async (sessionId) => {
            // Simulate driver emitting progress
            eventBus.publish({
                type: 'stream.progress',
                sessionId,
                progressText: '_reading the codebase..._',
            });

            await new Promise(r => setTimeout(r, 30));

            // Simulate driver completing
            eventBus.publish({
                type: 'driver.complete',
                sessionId,
                result: 'I found the bug on line 42.',
            });
        });

        eventBus.publish({
            type: 'message.received',
            sessionId: 'user1',
            adapterName: 'test',
            payload: 'find the bug',
        });

        await new Promise(r => setTimeout(r, 200));

        // Step 1: Thinking placeholder was sent
        const sendCalls = mockAdapter.sendMessage.mock.calls;
        expect(sendCalls.length).toBeGreaterThanOrEqual(1);
        expect(sendCalls[0][1]).toContain('on it');

        // Step 2: Progress was edited into the placeholder
        const editCalls = mockAdapter.editMessage.mock.calls;
        expect(editCalls.length).toBeGreaterThanOrEqual(1);

        // Step 3: Final result was edited into the placeholder
        const lastEdit = editCalls[editCalls.length - 1];
        expect(lastEdit[2]).toContain('I found the bug on line 42.');

        // Step 4: Cleanup
        expect(router.liveMessageIds.has('user1')).toBe(false);
        expect(router.progressTimers.has('user1')).toBe(false);
    });

    // ----------------------------------------------------------------
    // 8. editMessage failure fallback
    // ----------------------------------------------------------------

    it('should fall back to sendMessage if editMessage fails on complete', async () => {
        router.liveMessageIds.set('sess1', 'placeholder-msg-1');
        router.sessionRouting.set('sess1', { adapterName: 'test' });

        // Make edit fail
        mockAdapter.editMessage.mockRejectedValueOnce(new Error('WhatsApp edit expired'));

        eventBus.publish({
            type: 'driver.complete',
            sessionId: 'sess1',
            result: 'fallback answer',
        });

        await new Promise(r => setTimeout(r, 100));

        // Should have tried edit, then fallen back to sendMessage
        expect(mockAdapter.editMessage).toHaveBeenCalled();
        expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
            'sess1',
            'fallback answer',
            expect.any(Object),
        );
    });
});
