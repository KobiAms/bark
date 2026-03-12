import { toolIcon, buildProgressText } from '@bark/driver-shared';

export { buildProgressText };

export function parseLine(line) {
    if (!line.trim()) return null;
    try {
        const data = JSON.parse(line);

        if (data.type === 'init') {
            return { type: 'init', sessionId: data.session_id, model: data.model };
        }
        if (data.type === 'thinking') {
            return { type: 'thinking', text: data.content || '' };
        }
        if (data.type === 'message' && data.role === 'assistant') {
            return { type: 'text', text: data.content || '', delta: data.delta || false };
        }
        if (data.type === 'tool_use') {
            const name = data.tool_name || 'tool';
            return { type: 'tool', name, icon: toolIcon(name) };
        }
        if (data.type === 'tool_result') {
            return { type: 'tool_result', toolId: data.tool_id, status: data.status };
        }
        if (data.type === 'result') {
            return { type: 'result', text: data.content || '', isError: data.status !== 'success' };
        }

        return null;
    } catch {
        return null;
    }
}
