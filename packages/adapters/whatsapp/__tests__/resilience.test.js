import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppAdapter } from '../src/index.js';

describe('_getBackoffDelay', () => {
    let adapter;
    beforeEach(() => {
        adapter = new WhatsAppAdapter({ groupName: 'test' });
    });

    it('returns 5s on attempt 1', () => {
        expect(adapter._getBackoffDelay(1)).toBe(5000);
    });
    it('returns 10s on attempt 2', () => {
        expect(adapter._getBackoffDelay(2)).toBe(10_000);
    });
    it('caps at 300s', () => {
        expect(adapter._getBackoffDelay(100)).toBe(300_000);
    });
    it('attempt 6 = 160s', () => {
        expect(adapter._getBackoffDelay(6)).toBe(160_000);
    });
});

describe('heartbeat', () => {
    let adapter;

    beforeEach(() => {
        vi.useFakeTimers();
        adapter = new WhatsAppAdapter({ groupName: 'test' });
        adapter.waState = 'connected';
        adapter.isReconnecting = false;
        adapter.setLogger({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
    });

    afterEach(() => {
        adapter._stopHeartbeat();
        vi.useRealTimers();
    });

    it('calls _scheduleReconnect when getState returns non-CONNECTED', async () => {
        adapter.client = { getState: vi.fn().mockResolvedValue('TIMEOUT') };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(adapter._scheduleReconnect).toHaveBeenCalledOnce();
    });

    it('does not call _scheduleReconnect when getState returns CONNECTED', async () => {
        adapter.client = { getState: vi.fn().mockResolvedValue('CONNECTED') };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(adapter._scheduleReconnect).not.toHaveBeenCalled();
    });

    it('calls _scheduleReconnect when getState throws', async () => {
        adapter.client = { getState: vi.fn().mockRejectedValue(new Error('Browser gone')) };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(adapter._scheduleReconnect).toHaveBeenCalledOnce();
    });

    it('skips heartbeat check if waState is not connected', async () => {
        adapter.waState = 'disconnected';
        adapter.client = { getState: vi.fn() };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(adapter.client.getState).not.toHaveBeenCalled();
    });

    it('skips heartbeat check if already reconnecting', async () => {
        adapter.isReconnecting = true;
        adapter.client = { getState: vi.fn() };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        await vi.advanceTimersByTimeAsync(30_000);
        expect(adapter.client.getState).not.toHaveBeenCalled();
    });

    it('_stopHeartbeat clears the interval', async () => {
        adapter.client = { getState: vi.fn().mockResolvedValue('CONNECTED') };
        adapter._scheduleReconnect = vi.fn();
        adapter._startHeartbeat();
        adapter._stopHeartbeat();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(adapter.client.getState).not.toHaveBeenCalled();
    });
});

describe('_scheduleReconnect', () => {
    let adapter;

    beforeEach(() => {
        vi.useFakeTimers();
        adapter = new WhatsAppAdapter({ groupName: 'test' });
        adapter.setLogger({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
        adapter._doReconnect = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('sets isReconnecting and increments attempt counter', () => {
        adapter._scheduleReconnect();
        expect(adapter.isReconnecting).toBe(true);
        expect(adapter.reconnectAttempts).toBe(1);
    });

    it('calls _doReconnect after backoff delay', async () => {
        adapter._scheduleReconnect();
        expect(adapter._doReconnect).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5000);
        expect(adapter._doReconnect).toHaveBeenCalledOnce();
    });

    it('is a no-op if already reconnecting', () => {
        adapter.isReconnecting = true;
        adapter.reconnectAttempts = 3;
        adapter._scheduleReconnect();
        expect(adapter.reconnectAttempts).toBe(3);
    });

    it('uses exponential backoff on repeated calls', async () => {
        adapter._scheduleReconnect();
        await vi.advanceTimersByTimeAsync(5000);
        expect(adapter._doReconnect).toHaveBeenCalledTimes(1);

        adapter.isReconnecting = false;

        adapter._scheduleReconnect();
        await vi.advanceTimersByTimeAsync(5000);
        expect(adapter._doReconnect).toHaveBeenCalledTimes(1); // not yet at 10s
        await vi.advanceTimersByTimeAsync(5000);
        expect(adapter._doReconnect).toHaveBeenCalledTimes(2); // now at 10s total
    });
});

describe('_doReconnect', () => {
    let adapter;
    let mockClient;

    beforeEach(() => {
        adapter = new WhatsAppAdapter({ groupName: 'test' });
        adapter.setLogger({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
        adapter.isReconnecting = true;
        adapter.reconnectAttempts = 1;

        mockClient = {
            destroy: vi.fn().mockResolvedValue(undefined),
            initialize: vi.fn().mockResolvedValue(undefined),
            on: vi.fn(),
            once: vi.fn(),
        };

        adapter._createClient = vi.fn().mockReturnValue(mockClient);
        adapter._setupClientEvents = vi.fn();
        adapter._scheduleReconnect = vi.fn();
    });

    it('destroys old client', async () => {
        const oldClient = { destroy: vi.fn().mockResolvedValue(undefined) };
        adapter.client = oldClient;
        await adapter._doReconnect();
        expect(oldClient.destroy).toHaveBeenCalledOnce();
    });

    it('creates new client and assigns it', async () => {
        adapter.client = { destroy: vi.fn().mockResolvedValue(undefined) };
        await adapter._doReconnect();
        expect(adapter._createClient).toHaveBeenCalledOnce();
        expect(adapter.client).toBe(mockClient);
    });

    it('calls _setupClientEvents on new client', async () => {
        adapter.client = { destroy: vi.fn().mockResolvedValue(undefined) };
        await adapter._doReconnect();
        expect(adapter._setupClientEvents).toHaveBeenCalledWith(mockClient);
    });

    it('calls initialize on new client', async () => {
        adapter.client = { destroy: vi.fn().mockResolvedValue(undefined) };
        await adapter._doReconnect();
        expect(mockClient.initialize).toHaveBeenCalledOnce();
    });

    it('schedules another reconnect if initialize throws', async () => {
        adapter.client = { destroy: vi.fn().mockResolvedValue(undefined) };
        mockClient.initialize = vi.fn().mockRejectedValue(new Error('Puppeteer failed'));
        await adapter._doReconnect();
        expect(adapter._scheduleReconnect).toHaveBeenCalledOnce();
        expect(adapter.isReconnecting).toBe(false);
    });

    it('tolerates old client.destroy() throwing', async () => {
        adapter.client = { destroy: vi.fn().mockRejectedValue(new Error('Already gone')) };
        await expect(adapter._doReconnect()).resolves.not.toThrow();
        expect(adapter._createClient).toHaveBeenCalled();
    });
});
