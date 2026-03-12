import { IAdapter } from '@bark/core';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { existsSync, rmSync, writeFileSync, mkdtempSync } from 'fs';
import path, { join, extname } from 'path';
import { tmpdir } from 'os';

/**
 * Chromium leaves behind singleton lock/socket files when the process is killed
 * abruptly (e.g. Ctrl+C). On the next start these stale files cause Chromium
 * to bail out and whatsapp-web.js to wipe the auth dir — forcing a fresh QR scan.
 */
function clearChromiumLocks(dataPath, sessionName = 'session') {
    const profileDir = path.join(dataPath, sessionName);
    if (!existsSync(profileDir)) return;
    const lockFiles = [
        'SingletonLock',
        'SingletonSocket',
        'SingletonCookie',
        'DevToolsActivePort',
        'RunningChromeVersion',
    ];
    for (const f of lockFiles) {
        const fPath = path.join(profileDir, f);
        if (existsSync(fPath)) {
            try { rmSync(fPath, { force: true }); } catch { /* ignore */ }
        }
    }
}

export class WhatsAppAdapter extends IAdapter {
    constructor(config = {}) {
        super();
        this.groupName = config.groupName;
        if (!this.groupName) throw new Error('[WhatsAppAdapter] requires config.groupName');

        this.client = null;
        this.groupChat = null;
        this.waState = 'disconnected'; // 'disconnected' | 'waiting_qr' | 'connected'
        this.latestQrDataUrl = null;
        this.msgCache = new Map();

        this.messageCb = null;
        this.errorCb = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000; // 5 seconds
    }

    async start() {
        if (this.groupName === 'mock') {
            this.logger.log('[WhatsAppAdapter] Running in MOCK mode. Bypassing Chromium download.');
            this.waState = 'connected';
            this.groupChat = { name: 'mock' };
            return;
        }

        const INIT_TIMEOUT_MS = 120_000;

        this.client = new Client({
            authStrategy: new LocalAuth({ dataPath: '.wwebjs_auth' }),
            puppeteer: {
                headless: true,
                handleSIGINT: false,
                handleSIGTERM: false,
                handleSIGHUP: false,
                args: [
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-zygote',
                ],
            },
        });

        this.client.on('qr', (qr) => {
            this.waState = 'waiting_qr';
            this.logger.log('\n[WhatsAppAdapter] QR Code received. Please scan to authenticate.');
            // We could emit a special BarkEvent for QR codes, but for now we just stdout the raw data
            import('qrcode-terminal').then(module => {
                module.default.generate(qr, { small: true });
            }).catch(e => this.logger.error('[WhatsAppAdapter] Could not load qrcode-terminal', e));
        });

        this.client.on('authenticated', () => {
            this.logger.log('[WhatsAppAdapter] Authenticated');
            this.waState = 'authenticating';
            this.latestQrDataUrl = null;
        });

        this.client.on('auth_failure', (msg) => {
            this.logger.error(`[WhatsAppAdapter] Auth failed: ${msg}`);
            this.waState = 'disconnected';
            if (this.errorCb) this.errorCb({ error: new Error(`WhatsApp Auth Blocked: ${msg}`) });
        });

        this.client.on('disconnected', (reason) => {
            this.logger.log('[WhatsAppAdapter] Disconnected:', reason);
            this.waState = 'disconnected';
            this.groupChat = null;

            // Attempt automatic reconnection
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                this.logger.log(`[WhatsAppAdapter] Reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms...`);
                setTimeout(() => {
                    this.logger.log('[WhatsAppAdapter] Attempting to reconnect...');
                    this.client.initialize().catch(e => {
                        this.logger.error('[WhatsAppAdapter] Reconnection failed:', e.message);
                    });
                }, this.reconnectDelay);
            } else {
                this.logger.error('[WhatsAppAdapter] Max reconnection attempts reached. Manual intervention may be needed.');
            }
        });

        // Catch unhandled client errors to prevent process crash
        this.client.on('error', (error) => {
            this.logger.error('[WhatsAppAdapter] Client error:', error);
            this.waState = 'disconnected';
            if (this.errorCb) this.errorCb({ error });
        });

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    this.logger.log('[WhatsAppAdapter] Init timed out — continuing');
                    resolve();
                }
            }, INIT_TIMEOUT_MS);

            this.client.on('ready', async () => {
                settled = true;
                clearTimeout(timeout);
                this.logger.log('[WhatsAppAdapter] Client ready');
                this.reconnectAttempts = 0; // Reset reconnection counter on successful connect

                const chats = await this.client.getChats();
                this.groupChat = chats.find(c => c.isGroup && c.name === this.groupName);

                if (this.groupChat) {
                    this.waState = 'connected';
                    this.logger.log(`[WhatsAppAdapter] Listening on group: "${this.groupChat.name}"`);
                } else {
                    this.logger.warn(`[WhatsAppAdapter] Group "${this.groupName}" not found.`);
                    chats.filter(c => c.isGroup).forEach(c => this.logger.log(`  - ${c.name}`));
                }

                // Wire up inbound message handler
                this.client.on('message_create', async (msg) => {
                    if (!this.processInboundMessage) return;
                    await this.processInboundMessage(msg).catch(err => {
                        this.logger.error(`[WhatsAppAdapter] Unhandled error in message handler: ${err.message}`);
                    });
                });

                resolve();
            });

            clearChromiumLocks('.wwebjs_auth');
            this.client.initialize().catch(e => {
                this.logger.error(`[WhatsAppAdapter] Initialization failure:`, e);
                this.waState = 'disconnected';
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });
    }

    async processInboundMessage(msg) {
        let chat;
        try {
            chat = await msg.getChat();
        } catch (err) {
            this.logger.warn(`[WhatsAppAdapter] getChat() failed (likely a Channel/broadcast message) — skipping: ${err.message}`);
            return;
        }
        if (!chat.isGroup || chat.name !== this.groupName) return;
        if (msg.fromMe) return;

        let quotedMessageMetadata = null;
        if (msg.hasQuotedMsg) {
            try {
                const quotedMsg = await msg.getQuotedMessage();
                const contact = await quotedMsg.getContact();
                const senderName = contact.pushname || contact.name || contact.shortName;
                if (senderName) {
                    quotedMessageMetadata = {
                        senderName,
                        messageId: quotedMsg.id._serialized,
                        content: quotedMsg.body || ''
                    };
                }
            } catch (err) {
                this.logger.warn(`[WhatsAppAdapter] Failed to fetch quoted message data: ${err.message}`);
            }
        }

        const contact = await msg.getContact();
        const sender = contact.pushname || contact.number;
        
        let hasMedia = msg.hasMedia;
        let payload = msg.body.trim();

        if (hasMedia && msg.type === 'ptt' || msg.type === 'audio') {
            try {
                this.logger.log(`[WhatsAppAdapter] Downloading audio message...`);
                const media = await msg.downloadMedia();
                if (media && media.data) {
                    const workDir = mkdtempSync(join(tmpdir(), 'bark-wa-audio-'));
                    // WhatsApp often sends 'audio/ogg; codecs=opus'
                    const ext = media.mimetype ? (media.mimetype.includes('ogg') ? '.ogg' : '.mp3') : '.ogg';
                    const filePath = join(workDir, `voice${ext}`);
                    writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                    payload = { type: 'audio', filePath };
                }
            } catch (err) {
                this.logger.error(`[WhatsAppAdapter] Failed to download audio: ${err.message}`);
                // fallback to plain empty body if download fails
            }
        }

        // Emulate BarkEvent structure
        const event = {
            type: 'message.received',
            sessionId: `wa-group-${chat.id.user}`,
            senderId: contact.number || contact.id?.user || sender,
            senderName: sender,
            payload,
            rawId: msg.id._serialized, // Store for edits/replies
            hasMedia,
            isReply: msg.hasQuotedMsg,
            quotedMessageMetadata
        };

        if (this.messageCb) {
            this.messageCb(event);
        }
    }

    async stop() {
        if (this.client) {
            await this.client.destroy();
            this.client = null;
        }
    }

    async sendMessage(sessionId, payload, metadata = {}) {
        if (!this.groupChat) throw new Error('[WhatsAppAdapter] not connected to target group');
        const text = typeof payload === 'string' ? payload : payload.text || '';
        
        const options = {};
        if (metadata.replyToMessageId) {
            options.quotedMessageId = metadata.replyToMessageId;
        }

        const sent = await this.groupChat.sendMessage(text, options);
        this.msgCache.set(sent.id._serialized, sent);
        return { messageId: sent.id._serialized };
    }

    async editMessage(sessionId, messageId, text) {
        let msg = this.msgCache.get(messageId);
        if (!msg) {
            try {
                msg = await this.client.getMessageById(messageId);
            } catch {
                this.logger.warn('[WhatsAppAdapter] editMessage: message not found:', messageId);
                return;
            }
        }
        try {
            await msg.edit(text);
        } catch (err) {
            this.logger.error('[WhatsAppAdapter] Edit failed:', err.message);
        }
    }

    async announce(text) {
        if (!this.groupChat) return;
        await this.groupChat.sendMessage(text).catch(() => {});
    }

    async sendFile(sessionId, fileData, metadata = {}) {
        if (!this.groupChat) throw new Error('[WhatsAppAdapter] not connected to target group');

        try {
            const { MessageMedia } = await import('whatsapp-web.js');
            const media = await MessageMedia.fromFilePath(fileData.filePath);

            const options = {};
            if (fileData.caption) {
                options.caption = fileData.caption;
            }
            if (metadata.replyToMessageId) {
                options.quotedMessageId = metadata.replyToMessageId;
            }

            const sent = await this.groupChat.sendMessage(media, options);
            this.msgCache.set(sent.id._serialized, sent);
            this.logger.log(`[WhatsAppAdapter] Sent file: ${fileData.fileName || 'untitled'}`);
            return { messageId: sent.id._serialized };
        } catch (err) {
            this.logger.error('[WhatsAppAdapter] Failed to send file:', err.message);
            throw err;
        }
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }
}
