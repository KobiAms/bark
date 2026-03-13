export class ProgressFormatter {
    static format({ prefix, progressText, flushCount, thinkingStartTime }) {
        const dots = '.'.repeat((flushCount % 3) + 1);
        const elapsed = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : 0;
        const elapsedLabel = elapsed >= 5 ? ` (${elapsed}s)` : '';
        const label = prefix ? prefix.trimEnd() + ` _on it${dots}_${elapsedLabel}` : `_on it${dots}_${elapsedLabel}`;

        let body = label;
        if (progressText) {
            body += '\n\n' + progressText;
        }
        return body;
    }
}
