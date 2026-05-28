import { describe, it, expect, beforeEach } from 'vitest';
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
