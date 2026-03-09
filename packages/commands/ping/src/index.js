import { ICommand } from '@bark/core';

export class PingCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase() === '/ping';
    }

    async execute({ sessionId, payload, registry, eventBus }) {
        // Find the adapter to send the response directly
        // Alternatively, we could emit a custom event, but since we want to respond to the user:
        // In a perfectly decoupled world, we just emit a 'stream.chunk' or 'command.result'
        
        eventBus.publish({
            type: 'stream.chunk',
            sessionId,
            chunk: 'Pong! 🏓'
        });

        eventBus.publish({
            type: 'command.complete', // Semantically correct
            sessionId,
            result: 'Pong! 🏓'
        });
    }
}
