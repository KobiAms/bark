import { IAdapter } from '@bark/core';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'fs';
import { dirname, join, extname } from 'path';
import { tmpdir } from 'os';

export class TelegramAdapter extends IAdapter {
    /**
     * @param {Object} config
     * @param {string} config.token - Telegram Bot Token
     * @param {string} [config.chatId] - Optional pinned chat ID to listen to
     * @param {string} [config.stateFile] - Path to persist chatId across restarts
     * @param {string[]} [config.allowedUserIds] - Allowlist of Telegram user IDs. If set, messages from any other user are silently ignored.
     */
    constructor(config) {
        super();
        this.token = config.token;
        this.stateFile = config.stateFile || null;
        this.chatId = config.chatId || null;
        this.allowedUserIds = config.allowedUserIds
            ? new Set(config.allowedUserIds.map(String))
            : null;
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
        if (!this.allowedUserIds) throw new Error('[TelegramAdapter] allowedUserIds is required. Set TELEGRAM_ALLOWED_USER_IDS in your env file. Get your user ID from @userinfobot on Telegram.');
        
        if (this.token === 'mock') {
            this.logger.log('[TelegramAdapter] Running in MOCK mode. Bypassing API validation.');
            this.botInfo = { username: 'mock_bot', id: 12345 };
            return;
        }

        const me = await this._api('getMe', {});
        this.botInfo = me;
        this.logger.log(`[TelegramAdapter] Bot connected: @${me.username}`);

        if (!this.chatId) {
            this.chatId = this._loadChatId(me.id) || null;
        }

        if (this.chatId) {
            this.logger.log(`[TelegramAdapter] Listening strictly to chat: ${this.chatId}`);
        } else {
            this.logger.log(`[TelegramAdapter] Waiting for first message to lock onto a chat ID...`);
        }

        this.polling = true;
        this._pollLoop().catch(err => {
            this.logger.error('[TelegramAdapter] Polling loop crashed', err);
            if (this.errorCb) this.errorCb(err);
        });
    }

    async stop() {
        this.polling = false;
        if (this.pollTimeout) clearTimeout(this.pollTimeout);
        this.logger.log('[TelegramAdapter] Stopped.');
    }

    async sendMessage(sessionId, payload, metadata = {}) {
        if (!this.chatId) return;
        try {
            const body = {
                chat_id: this.chatId,
                text: payload,
                parse_mode: 'Markdown',
            };
            if (metadata.replyToMessageId) {
                body.reply_to_message_id = Number(metadata.replyToMessageId);
            }
            const result = await this._api('sendMessage', body);
            return { messageId: String(result.message_id) };
        } catch (err) {
            // Retry as plain text if Markdown parse fails
            try {
                const body = {
                    chat_id: this.chatId,
                    text: payload,
                };
                if (metadata.replyToMessageId) {
                    body.reply_to_message_id = Number(metadata.replyToMessageId);
                }
                const result = await this._api('sendMessage', body);
                return { messageId: String(result.message_id) };
            } catch (err2) {
                this.logger.error('[TelegramAdapter] Send failed:', err2.message);
            }
        }
    }

    async editMessage(sessionId, messageId, text) {
        if (!this.chatId || !messageId) return;
        try {
            await this._api('editMessageText', {
                chat_id: this.chatId,
                message_id: Number(messageId),
                text,
                parse_mode: 'Markdown',
            });
        } catch (err) {
            if (err.message?.includes('parse')) {
                // Retry as plain text if Markdown parse fails
                await this._api('editMessageText', {
                    chat_id: this.chatId,
                    message_id: Number(messageId),
                    text,
                }).catch(() => {});
            } else if (!err.message?.includes('message is not modified')) {
                // Rethrow so callers (e.g. _editOrSend) can fall back to sendMessage.
                // "message is not modified" is harmless — silently ignore it.
                throw err;
            }
        }
    }

    async announce(text) {
        if (!this.chatId) return;
        await this._api('sendMessage', { chat_id: this.chatId, text }).catch(() => {});
    }

    async sendFile(sessionId, fileData, metadata = {}) {
        if (!this.chatId) throw new Error('[TelegramAdapter] not connected to chat');

        try {
            const { readFileSync } = await import('fs');
            const fileContent = readFileSync(fileData.filePath);

            // Determine method based on MIME type
            let method = 'sendDocument'; // default for unknown types
            if (fileData.mimeType?.startsWith('image/')) {
                method = 'sendPhoto';
            } else if (fileData.mimeType?.startsWith('audio/')) {
                method = 'sendAudio';
            } else if (fileData.mimeType?.startsWith('video/')) {
                method = 'sendVideo';
            }

            const body = new FormData();
            body.append('chat_id', this.chatId);
            body.append(method === 'sendPhoto' ? 'photo' : method === 'sendAudio' ? 'audio' : method === 'sendVideo' ? 'video' : 'document',
                new Blob([fileContent], { type: fileData.mimeType }),
                fileData.fileName || 'file'
            );

            if (fileData.caption) {
                body.append('caption', fileData.caption);
            }

            if (metadata.replyToMessageId) {
                body.append('reply_to_message_id', Number(metadata.replyToMessageId));
            }

            const res = await fetch(`${this.BASE_URL}/${method}`, {
                method: 'POST',
                body
            });

            const data = await res.json();
            if (!data.ok) throw new Error(data.description);

            this.logger.log(`[TelegramAdapter] Sent file: ${fileData.fileName || 'untitled'}`);
            return { messageId: String(data.result.message_id) };
        } catch (err) {
            this.logger.error('[TelegramAdapter] Failed to send file:', err.message);
            throw err;
        }
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }

    // --- State Persistence ---

    _loadChatId(botId) {
        if (!this.stateFile) return null;
        try {
            const data = JSON.parse(readFileSync(this.stateFile, 'utf8'));
            if (!data.botId || data.botId !== botId) {
                this.logger.log(`[TelegramAdapter] Bot changed or unverified state — discarding saved chatId.`);
                return null;
            }
            if (data.chatId) {
                this.logger.log(`[TelegramAdapter] Restored chatId from state: ${data.chatId}`);
                return data.chatId;
            }
        } catch { /* file doesn't exist yet */ }
        return null;
    }

    _saveChatId(chatId) {
        if (!this.stateFile) return;
        try {
            mkdirSync(dirname(this.stateFile), { recursive: true });
            writeFileSync(this.stateFile, JSON.stringify({ botId: this.botInfo?.id, chatId }), 'utf8');
        } catch (err) {
            this.logger.error('[TelegramAdapter] Failed to save state:', err.message);
        }
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
                        this._saveChatId(this.chatId);
                        this.logger.log(`[TelegramAdapter] Auto-locked to chat: ${this.chatId}`);
                    }

                    // Strict chat routing
                    if (String(msg.chat.id) !== this.chatId) continue;
                    
                    // Ignore self
                    if (this.botInfo && msg.from?.id === this.botInfo.id) continue;

                    // Allowlist — silently drop messages from non-approved users
                    if (this.allowedUserIds && !this.allowedUserIds.has(String(msg.from?.id))) continue;

                    const text = msg.text || msg.caption || '';
                    const voice = msg.voice || msg.audio;

                    if (!text.trim() && !voice) continue;

                    if (this.messageCb) {
                        let payload = text.trim();
                        
                        if (voice) {
                            try {
                                this.logger.log(`[TelegramAdapter] Downloading voice message (${voice.file_id})...`);
                                const filePath = await this._downloadFile(voice.file_id);
                                payload = { type: 'audio', filePath };
                            } catch (err) {
                                this.logger.error(`[TelegramAdapter] Failed to download voice: ${err.message}`);
                                continue; // Skip this message if we can't get the audio
                            }
                        }

                        let quotedMessageMetadata = null;
                        if (msg.reply_to_message) {
                            const q = msg.reply_to_message;
                            const from = q.from || {};
                            quotedMessageMetadata = {
                                senderName: from.username || from.first_name || 'unknown',
                                messageId: String(q.message_id),
                                content: q.text || q.caption || ''
                            };
                        }

                        this.messageCb({
                            type: 'message.received',
                            sessionId: `tg-${this.chatId}`,
                            payload,
                            senderId: String(msg.from?.id || 'unknown'),
                            rawId: String(msg.message_id),
                            quotedMessageMetadata
                        });
                    }
                }
            } catch (err) {
                if (!this.polling) break;
                this.consecutiveErrors++;
                this.logger.error(`[TelegramAdapter] Poll Error: ${err.message}`);
                await new Promise(r => { this.pollTimeout = setTimeout(r, Math.min(5000 * this.consecutiveErrors, 30000)); });
            }
        }
    }

    /**
     * Download a file from Telegram and return local path.
     * @private
     */
    async _downloadFile(fileId) {
        const file = await this._api('getFile', { file_id: fileId });
        const url = `https://api.telegram.org/file/bot${this.token}/${file.file_path}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Download failed: ${res.statusText}`);
        
        const buffer = Buffer.from(await res.arrayBuffer());
        
        const workDir = mkdtempSync(join(tmpdir(), 'bark-tg-audio-'));
        const ext = extname(file.file_path) || '.ogg';
        const filePath = join(workDir, `voice${ext}`);
        
        writeFileSync(filePath, buffer);
        return filePath;
    }
}
