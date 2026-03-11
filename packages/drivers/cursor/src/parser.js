/**
 * Cursor CLI stream-json parser
 * Processes output from `agent -p --output-format stream-json --force`
 *
 * Event types emitted by the Cursor CLI:
 *   system   – init event with session_id, model, cwd
 *   user     – echoed user message
 *   assistant – full or partial assistant message
 *   tool_call – started / completed tool invocations
 *   result   – terminal event with final text + duration
 */

const TOOL_ICONS = {
    read: '📖', write: '📝', edit: '✏️', shell: '💻', grep: '🔍',
    glob: '📂', ls: '📂', delete: '🗑️', todo: '📋',
    Read: '📖', Write: '📝', Edit: '✏️', Bash: '💻', Grep: '🔍',
    Glob: '📂', WebFetch: '🌐', WebSearch: '🌐',
};

/**
 * Extract a human-readable tool name from the tool_call object.
 * Cursor uses keys like `readToolCall`, `shellToolCall`, etc.
 */
function extractToolName(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') return 'tool';
    for (const key of Object.keys(toolCall)) {
        // Strip the 'ToolCall' suffix: "readToolCall" → "read"
        const name = key.replace(/ToolCall$/, '');
        if (name) return name;
    }
    return 'tool';
}

function toolIcon(name) {
    if (TOOL_ICONS[name]) return TOOL_ICONS[name];
    const lower = name.toLowerCase();
    for (const [key, icon] of Object.entries(TOOL_ICONS)) {
        if (lower.includes(key.toLowerCase())) return icon;
    }
    return '🔧';
}

export function parseLine(line) {
    if (!line.trim()) return null;
    try {
        const data = JSON.parse(line);

        // system init — carries session_id and model
        if (data.type === 'system' && data.subtype === 'init') {
            return { type: 'init', sessionId: data.session_id, model: data.model };
        }

        // assistant message — may contain text content
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

        // tool_call started
        if (data.type === 'tool_call' && data.subtype === 'started') {
            const name = extractToolName(data.tool_call);
            return { type: 'tool', name, icon: toolIcon(name) };
        }

        // result — terminal event
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

/**
 * Build a short human-readable progress string from accumulated state.
 * @param {string} progressText - accumulated thinking/text so far
 * @param {Array<{icon:string, name:string}>} tools - tools used so far
 * @returns {string}
 */
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
