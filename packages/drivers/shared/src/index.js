const TOOL_ICONS = {
    // Capitalized (Claude Code, generic)
    Bash: '💻', Read: '📖', Edit: '✏️', Write: '📝', Grep: '🔍', Glob: '📂',
    WebFetch: '🌐', WebSearch: '🌐', Skill: '⚡', Task: '🔀',
    // Lowercase (OpenCode, Cursor)
    bash: '💻', read: '📖', edit: '✏️', write: '📝', grep: '🔍', glob: '📂',
    webfetch: '🌐', websearch: '🌐', task: '🔀', list: '📂',
    // Gemini-specific
    list_directory: '📂', read_file: '📖', write_file: '📝', edit_file: '✏️',
    shell: '💻', run_command: '💻',
    // Codex-specific
    command_execution: '💻',
    // Cursor-specific
    ls: '📂', delete: '🗑️', todo: '📋',
};

export function toolIcon(name = '') {
    if (TOOL_ICONS[name]) return TOOL_ICONS[name];
    for (const [key, icon] of Object.entries(TOOL_ICONS)) {
        if (name.toLowerCase().includes(key.toLowerCase())) return icon;
    }
    if (name.startsWith('mcp__')) return '🔌';
    return '🔧';
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
