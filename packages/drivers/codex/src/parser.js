/**
 * Codex CLI JSON stream parser.
 */

const TOOL_ICONS = {
    Bash: '💻',
    Read: '📖',
    Edit: '✏️',
    Write: '📝',
    Grep: '🔍',
    Glob: '📂',
    WebFetch: '🌐',
    WebSearch: '🌐',
    Skill: '⚡',
    Task: '🔀',
    command_execution: '💻',
    shell: '💻',
};

function toolIcon(name = '') {
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

        if (data.type === 'thread.started') {
            return { type: 'init', sessionId: data.thread_id };
        }

        if (data.type === 'item.started' && data.item?.type === 'command_execution') {
            return {
                type: 'tool',
                name: 'Bash',
                icon: '💻',
                command: data.item.command,
                status: 'in_progress',
            };
        }

        if (data.type === 'item.completed' && data.item) {
            if (data.item.type === 'reasoning') {
                return { type: 'thinking', text: data.item.text || '' };
            }

            if (data.item.type === 'agent_message') {
                return { type: 'text', text: data.item.text || '' };
            }

            if (data.item.type === 'command_execution') {
                return {
                    type: 'tool',
                    name: 'Bash',
                    icon: '💻',
                    command: data.item.command,
                    output: data.item.aggregated_output,
                    exitCode: data.item.exit_code,
                    status: data.item.status,
                };
            }
        }

        if (data.type === 'turn.completed') {
            return {
                type: 'result',
                text: '',
                isError: false,
                usage: data.usage || null,
            };
        }

        return null;
    } catch {
        return null;
    }
}

export function buildProgressText(progressText, tools) {
    const lines = [];
    const previewLen = 300;

    if (progressText) {
        const isTruncated = progressText.length > previewLen;
        let preview = progressText.slice(-previewLen).trim().replace(/\n/g, ' ');
        if (isTruncated) {
            const firstSpace = preview.indexOf(' ');
            if (firstSpace > 0) preview = preview.substring(firstSpace + 1);
            preview = '…' + preview;
        }
        lines.push(`_${preview}_`);
    }

    if (tools.length > 0) {
        lines.push(tools.slice(-5).map(t => `${toolIcon(t.name)} ${t.name}`).join(' → '));
    }

    return lines.length > 0 ? lines.join('\n') : '_thinking..._';
}
