import { EventEmitter } from 'events';

/**
 * A simple application-wide pub/sub event bus for normalized BarkEvents.
 * Acts as the centralized nervous system of the Bark orchestration layer.
 */
export class EventBus {
    constructor() {
        this.emitter = new EventEmitter();
        // Increase limit since we might have many adapters/drivers listening
        this.emitter.setMaxListeners(100);
    }

    /**
     * Publish an event to the bus.
     * @param {import('../interfaces/index.js').BarkEvent} barkEvent 
     */
    publish(barkEvent) {
        if (!barkEvent.type) {
            throw new Error('BarkEvent must have a valid type string.');
        }
        
        // Ensure timestamp exists
        if (!barkEvent.timestamp) {
            barkEvent.timestamp = new Date();
        }

        this.emitter.emit(barkEvent.type, barkEvent);
        
        // Catch-all monitor event, useful for debugging or logging plugins
        this.emitter.emit('*', barkEvent);
    }

    /**
     * Subscribe to a specific event type.
     * @param {string} eventType e.g., 'message.received', 'stream.chunk'
     * @param {function(import('../interfaces/index.js').BarkEvent):void} listener 
     * @returns {function():void} A function to unsubscribe this listener
     */
    subscribe(eventType, listener) {
        this.emitter.on(eventType, listener);
        return () => this.emitter.off(eventType, listener);
    }

}

