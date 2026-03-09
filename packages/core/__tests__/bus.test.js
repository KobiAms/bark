import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../src/bus/index.js';

describe('EventBus', () => {
    it('should publish and subscribe to events', () => {
        const bus = new EventBus();
        const mockListener = vi.fn();
        
        bus.subscribe('test.event', mockListener);
        bus.publish({ type: 'test.event', sessionId: '123' });

        expect(mockListener).toHaveBeenCalledTimes(1);
        expect(mockListener).toHaveBeenCalledWith(expect.objectContaining({ type: 'test.event', sessionId: '123' }));
    });

    it('should append a timestamp if absent', () => {
        const bus = new EventBus();
        const mockListener = vi.fn();
        bus.subscribe('test.event', mockListener);
        
        bus.publish({ type: 'test.event', sessionId: '123' });
        
        const eventArgs = mockListener.mock.calls[0][0];
        expect(eventArgs.timestamp).toBeInstanceOf(Date);
    });

    it('should throw if no type is provided', () => {
        const bus = new EventBus();
        // @ts-ignore
        expect(() => bus.publish({ sessionId: '123' })).toThrow(/BarkEvent must have a valid type string/);
    });

    it('should unsubscribe correctly', () => {
        const bus = new EventBus();
        const mockListener = vi.fn();
        
        const unsubscribe = bus.subscribe('test.event', mockListener);
        unsubscribe();
        
        bus.publish({ type: 'test.event', sessionId: '123' });
        expect(mockListener).not.toHaveBeenCalled();
    });
});
