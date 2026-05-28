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
