import { toolIcon, buildProgressText } from '@bark/driver-shared';

export { buildProgressText };

export function parseLine(line) {
    if (!line.trim()) return null;
    try {
        const data = JSON.parse(line);

        if (data.type === 'session.created' || data.type === 'session.updated' || data.type === 'step_start') {
            const id = data.sessionID || data.part?.sessionID || data.id;
            return id ? { type: 'init', sessionId: id } : null;
        }

        if (data.type === 'text') {
            return { type: 'text', text: (data.part || data).text || '' };
        }

        if (data.type === 'reasoning') {
            return { type: 'thinking', text: (data.part || data).text || '' };
        }

        if (data.type === 'tool_use') {
            const part = data.part || data;
            const name = part.tool || 'tool';
            const state = part.state || {};
            if (state.status === 'pending') return null;
            return { type: 'tool', name, icon: toolIcon(name), status: state.status };
        }

        if (data.type === 'step_finish') {
            return { type: 'result', text: '', isError: false };
        }

        if (data.type === 'message.part.updated' || data.type === 'message.part.delta') {
            const part = data.part || data.properties?.part;
            if (!part) return null;
            if (part.type === 'text') return { type: 'text', text: part.text || '' };
            if (part.type === 'reasoning') return { type: 'thinking', text: part.text || '' };
            if (part.type === 'tool') {
                const name = part.tool || 'tool';
                const state = part.state || {};
                if (state.status === 'pending') return null;
                return { type: 'tool', name, icon: toolIcon(name), status: state.status };
            }
            if (part.type === 'step-finish') return { type: 'result', text: '', isError: false };
        }

        if (data.type === 'session.error' || data.type === 'error') {
            const msg = data.error?.message || data.error || 'Unknown error';
            return { type: 'result', text: typeof msg === 'string' ? msg : JSON.stringify(msg), isError: true };
        }

        return null;
    } catch {
        return null;
    }
}
