/**
 * Gemini CLI stream-json parser
 * Processes output from `gemini --output-format stream-json`
 */

const TOOL_ICONS = {
    Bash: '💻', Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📂',
    WebFetch: '🌐', WebSearch: '🌐', Skill: '⚡', Task: '🔀',
    list_directory: '📂', read_file: '📖', write_file: '📝', edit_file: '✏️',
    shell: '💻', run_command: '💻',
};

function toolIcon(name) {
    if (TOOL_ICONS[name]) return TOOL_ICONS[name];
    for (const [key, icon] of Object.entries(TOOL_ICONS)) {
        if (name.toLowerCase().includes(key.toLowerCase())) return icon;
    }
    return '🔧';
}

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
