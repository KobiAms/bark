import { IAdapter } from '@bark/core';

export class TelegramAdapter extends IAdapter {
    /**
     * @param {Object} config 
     * @param {string} config.token - Telegram Bot Token
     * @param {string} [config.chatId] - Optional pinned chat ID to listen to
     */
    constructor(config) {
        super();
        this.token = config.token;
        this.chatId = config.chatId || null;
        this.polling = false;
        this.lastUpdateId = 0;
        this.pollTimeout = null;
        this.consecutiveErrors = 0;
        this.botInfo = null;
        
        this.messageCb = null;
        this.errorCb = null;

        this.BASE_URL = `https://api.telegram.org/bot${this.token}`;
    }

    async start() {
        if (!this.token) throw new Error('[TelegramAdapter] Token is required');
        
        if (this.token === 'mock') {
            console.log('[TelegramAdapter] Running in MOCK mode. Bypassing API validation.');
            this.botInfo = { username: 'mock_bot', id: 12345 };
            return;
        }

        const me = await this._api('getMe', {});
        this.botInfo = me;
        console.log(`[TelegramAdapter] Bot connected: @${me.username}`);
        
        if (this.chatId) {
            console.log(`[TelegramAdapter] Listening strictly to chat: ${this.chatId}`);
        } else {
            console.log(`[TelegramAdapter] Waiting for first message to lock onto a chat ID...`);
        }

        this.polling = true;
        this._pollLoop().catch(err => {
            console.error('[TelegramAdapter] Polling loop crashed', err);
            if (this.errorCb) this.errorCb(err);
        });
    }

    async stop() {
        this.polling = false;
        if (this.pollTimeout) clearTimeout(this.pollTimeout);
        console.log('[TelegramAdapter] Stopped.');
    }

    async sendMessage(sessionId, payload) {
        if (!this.chatId) return; // Cannot send if chat is unknown
        
        // For streams, Telegram doesn't do true typing, it sends chunks.
        // We will just send the payload as a new message for now.
        // In a more complex implementation, we'd cache the message ID and edit it.
        try {
            await this._api('sendMessage', {
                chat_id: this.chatId,
                text: payload
            });
        } catch (err) {
            console.error('[TelegramAdapter] Send failed:', err.message);
        }
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }

    // --- Internal Telegram API Logic ---

    async _api(method, body, timeoutMs = 15000) {
        if (method === 'getUpdates') timeoutMs = 45000;
        
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        
        try {
            const res = await fetch(`${this.BASE_URL}/${method}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            const data = await res.json();
            if (!data.ok) throw new Error(data.description);
            return data.result;
        } finally {
            clearTimeout(timer);
        }
    }

    async _pollLoop() {
        while (this.polling) {
            try {
                const updates = await this._api('getUpdates', {
                    timeout: 30,
                    offset: this.lastUpdateId + 1,
                    allowed_updates: ['message']
                });

                this.consecutiveErrors = 0;
                
                for (const update of updates) {
                    this.lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg) continue;

                    // Auto-lock chat ID on first message
                    if (!this.chatId) {
                        this.chatId = String(msg.chat.id);
                        console.log(`[TelegramAdapter] Auto-locked to chat: ${this.chatId}`);
                    }

                    // Strict chat routing
                    if (String(msg.chat.id) !== this.chatId) continue;
                    
                    // Ignore self
                    if (this.botInfo && msg.from?.id === this.botInfo.id) continue;

                    const text = msg.text || msg.caption || '';
                    if (!text.trim()) continue;

                    if (this.messageCb) {
                        this.messageCb({
                            type: 'message.received',
                            sessionId: `tg-${this.chatId}`, // We use the group chat ID as the session
                            payload: text,
                            senderId: String(msg.from?.id || 'unknown')
                        });
                    }
                }
            } catch (err) {
                if (!this.polling) break;
                this.consecutiveErrors++;
                console.error(`[TelegramAdapter] Poll Error: ${err.message}`);
                await new Promise(r => { this.pollTimeout = setTimeout(r, Math.min(5000 * this.consecutiveErrors, 30000)); });
            }
        }
    }
}
