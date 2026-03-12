import { toolIcon, buildProgressText } from '@bark/driver-shared';

export { buildProgressText };

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
