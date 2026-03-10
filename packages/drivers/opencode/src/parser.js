/**
 * OpenCode CLI stream parser
 * Processes output from `opencode run --format json`
 */

const TOOL_ICONS = {
    bash: '💻', read: '📖', edit: '✏️', write: '📝', grep: '🔍', glob: '📂',
    webfetch: '🌐', websearch: '🌐', task: '🔀', list: '📂',
    Bash: '💻', Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📂',
    WebFetch: '🌐', WebSearch: '🌐', Task: '🔀',
};

function toolIcon(name) {
    if (TOOL_ICONS[name]) return TOOL_ICONS[name];
    const lower = name.toLowerCase();
    for (const [key, icon] of Object.entries(TOOL_ICONS)) {
        if (lower.includes(key.toLowerCase())) return icon;
    }
    if (name.startsWith('mcp__')) return '🔌';
    return '🔧';
}

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

export function buildProgressText(progressText, tools) {
    const lines = [];
    const PREVIEW_LEN = 300;

    if (progressText) {
        const isTruncated = progressText.length > PREVIEW_LEN;
        let preview = progressText.slice(-PREVIEW_LEN).trim().replace(/\n/g, ' ');
        if (isTruncated) {
            const firstSpace = preview.indexOf(' ');
            if (firstSpace > 0) preview = preview.substring(firstSpace + 1);
            preview = '…' + preview;
        }
        lines.push(`_${preview}_`);
    }

    if (tools.length > 0) {
        lines.push(tools.slice(-5).map(t => `${t.icon} ${t.name}`).join(' → '));
    }

    return lines.length > 0 ? lines.join('\n') : '_thinking..._';
}
