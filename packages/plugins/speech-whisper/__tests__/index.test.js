import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WhisperPlugin } from '../src/index.js';
import { EventTypes } from '@bark/core';

// Mock Node modules
vi.mock('child_process', () => ({
    execFile: vi.fn((file, args, cb) => cb(null, { stdout: '', stderr: '' }))
}));

vi.mock('fs', () => ({
    mkdtempSync: vi.fn(() => '/tmp/bark-whisper-123'),
    rmSync: vi.fn(),
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(() => '  mocked transcription  \n')
}));

vi.mock('os', () => ({
    tmpdir: vi.fn(() => '/tmp')
}));

// Mock EventBus
class MockEventBus {
    constructor() {
        this.handlers = {};
        this.published = [];
    }
    subscribe(event, handler) {
        this.handlers[event] = handler;
        return () => { delete this.handlers[event]; };
    }
    publish(event) {
        this.published.push(event);
    }
}

describe('WhisperPlugin', () => {
    let bus;
    
    beforeEach(() => {
        bus = new MockEventBus();
        vi.clearAllMocks();
    });

    it('should require modelPath', () => {
        expect(() => new WhisperPlugin()).toThrow(/config.modelPath is required/);
    });

    it('should pass through string payloads unmodified', async () => {
        const plugin = new WhisperPlugin({ modelPath: '/path/to/model.gguf' });
        plugin.register(bus);

        const handler = bus.handlers[EventTypes.MESSAGE_RECEIVED];
        expect(handler).toBeDefined();

        await handler({ type: EventTypes.MESSAGE_RECEIVED, payload: 'hello text', sessionId: '1' });

        expect(bus.published).toHaveLength(1);
        expect(bus.published[0]).toEqual({
            type: EventTypes.MESSAGE_RECEIVED_TEXT,
            payload: 'hello text',
            sessionId: '1'
        });
    });

    it('should transcribe audio payloads', async () => {
        const plugin = new WhisperPlugin({ modelPath: '/path/to/model.gguf' });
        plugin.register(bus);

        const handler = bus.handlers[EventTypes.MESSAGE_RECEIVED];
        await handler({ 
            type: EventTypes.MESSAGE_RECEIVED, 
            payload: { type: 'audio', filePath: '/path/to/audio.ogg' }, 
            sessionId: '1' 
        });

        expect(bus.published).toHaveLength(1);
        expect(bus.published[0]).toEqual({
            type: EventTypes.MESSAGE_RECEIVED_TEXT,
            payload: 'mocked transcription',
            sessionId: '1'
        });
    });

    it('should gracefully handle transcription failures', async () => {
        const plugin = new WhisperPlugin({ modelPath: '/path/to/model.gguf' });
        plugin.register(bus);

        // Make fs.existsSync return false to simulate failure
        const fs = await import('fs');
        fs.existsSync.mockReturnValueOnce(false);

        const handler = bus.handlers[EventTypes.MESSAGE_RECEIVED];
        await handler({ 
            type: EventTypes.MESSAGE_RECEIVED, 
            payload: { type: 'audio', filePath: '/path/to/audio.ogg' }, 
            sessionId: '1' 
        });

        expect(bus.published).toHaveLength(1);
        expect(bus.published[0]).toEqual({
            type: EventTypes.MESSAGE_RECEIVED_TEXT,
            payload: '[audio transcription failed]',
            sessionId: '1'
        });
    });
});
