import { toolIcon, buildProgressText } from '@bark/driver-shared';

export { buildProgressText };

function extractToolName(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') return 'tool';
    for (const key of Object.keys(toolCall)) {
        const name = key.replace(/ToolCall$/, '');
        if (name) return name;
    }
    return 'tool';
}

export function parseLine(line) {
    if (!line.trim()) return null;
    try {
        const data = JSON.parse(line);

        if (data.type === 'system' && data.subtype === 'init') {
            return { type: 'init', sessionId: data.session_id, model: data.model };
        }

        if (data.type === 'assistant') {
            const contents = data.message?.content || [];
            for (const block of contents) {
                if (block.type === 'text' && block.text) {
                    return { type: 'text', text: block.text };
                }
                if (block.type === 'thinking' && block.thinking) {
                    return { type: 'thinking', text: block.thinking };
                }
            }
            return null;
        }

        if (data.type === 'tool_call' && data.subtype === 'started') {
            const name = extractToolName(data.tool_call);
            return { type: 'tool', name, icon: toolIcon(name) };
        }

        if (data.type === 'result') {
            return {
                type: 'result',
                text: data.result || '',
                isError: !!data.is_error,
            };
        }

        return null;
    } catch {
        return null;
    }
}
