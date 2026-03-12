export class ProgressFormatter {
    static format({ prefix, progressText, streamedText, flushCount, thinkingStartTime }) {
        const dots = '.'.repeat((flushCount % 3) + 1);
        const elapsed = thinkingStartTime ? Math.round((Date.now() - thinkingStartTime) / 1000) : 0;
        const elapsedLabel = elapsed >= 5 ? ` (${elapsed}s)` : '';
        const label = prefix ? prefix.trimEnd() + ` _on it${dots}_${elapsedLabel}` : `_on it${dots}_${elapsedLabel}`;

        let body = label;
        if (progressText) {
            body += '\n\n' + progressText;
        }

        if (streamedText) {
            const MAX_MSG_LEN = 3500;
            const overhead = body.length + 4; // '\n\n' separator + margin
            const budget = MAX_MSG_LEN - overhead;
            if (budget > 0) {
                let visibleText = streamedText;
                if (visibleText.length > budget) {
                    visibleText = '…' + visibleText.slice(-budget);
                }
                body += '\n\n' + visibleText;
            }
        }
        return body;
    }
}
