import { ICommand } from '@bark/core';

export class PingCommand extends ICommand {
    match(message) {
        return typeof message === 'string' && message.trim().toLowerCase() === '/ping';
    }

    describe() {
        return { usage: '/ping', description: 'Health check', group: 'System' };
    }

    async execute({ sessionId, eventBus }) {
        eventBus.publish({ type: 'stream.chunk', sessionId, chunk: 'Pong! 🏓' });
        eventBus.publish({ type: 'command.complete', sessionId, result: 'Pong! 🏓' });
    }
}
