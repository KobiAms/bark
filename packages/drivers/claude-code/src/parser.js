/**
 * Claude Code stream-json parser
 * Processes output from `claude -p --output-format stream-json --verbose`
 */

const TOOL_ICONS = {
    Bash: '💻', Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📂',
    WebFetch: '🌐', WebSearch: '🌐', Skill: '⚡', Task: '🔀',
};

function toolIcon(name) {
    for (const [key, icon] of Object.entries(TOOL_ICONS)) {
        if (name.startsWith(key) || name.includes(key)) return icon;
    }
    if (name.startsWith('mcp__')) return '🔌';
    return '🔧';
}

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

        // Fallback: higher-level assistant event (emitted without --verbose)
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

/**
 * Build a short human-readable progress string from accumulated state.
 * @param {string} progressText - accumulated thinking/text so far
 * @param {Array<{icon:string, name:string}>} tools - tools used so far
 * @returns {string}
 */
export function buildProgressText(progressText, tools) {
    const lines = [];
    const PREVIEW_LEN = 200;

    if (progressText) {
        let preview = progressText.slice(-PREVIEW_LEN).trim();
        const firstSpace = preview.indexOf(' ');
        if (firstSpace > 0 && preview.length >= PREVIEW_LEN) {
            preview = preview.substring(firstSpace + 1);
        }
        lines.push(`_${preview.replace(/\n/g, ' ')}_`);
    }

    if (tools.length > 0) {
        lines.push(tools.slice(-5).map(t => `${t.icon} ${t.name}`).join(' → '));
    }

    return lines.length > 0 ? lines.join('\n') : '_thinking..._';
}
