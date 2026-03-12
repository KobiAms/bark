import { toolIcon, buildProgressText } from '@bark/driver-shared';

export { buildProgressText };

export function parseLine(line) {
    if (!line.trim()) return null;
    try {
        const data = JSON.parse(line);

        if (data.type === 'stream_event') {
            const event = data.event;

            if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
                return { type: 'thinking_start' };
            }
            if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
                return { type: 'thinking', text: event.delta.thinking };
            }
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                return { type: 'text', text: event.delta.text };
            }
            if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                const name = event.content_block.name || 'tool';
                return { type: 'tool', name, icon: toolIcon(name) };
            }
        }

        if (data.type === 'assistant') {
            const contents = data.message?.content || [];
            for (const content of contents) {
                if (content.type === 'text') {
                    return { type: 'text', text: content.text };
                }
            }
        }

        if (data.type === 'result') {
            return { type: 'result', text: data.result || '', isError: !!data.is_error };
        }

        return null;
    } catch {
        return null;
    }
}
