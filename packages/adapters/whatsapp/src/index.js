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
    }

    async start() {
        if (this.groupName === 'mock') {
            console.log('[WhatsAppAdapter] Running in MOCK mode. Bypassing Chromium download.');
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
            console.log('\n[WhatsAppAdapter] QR Code received. Please scan to authenticate.');
            // We could emit a special BarkEvent for QR codes, but for now we just stdout the raw data
            import('qrcode-terminal').then(module => {
                module.default.generate(qr, { small: true });
            }).catch(e => console.error('[WhatsAppAdapter] Could not load qrcode-terminal', e));
        });

        this.client.on('authenticated', () => {
            console.log('[WhatsAppAdapter] Authenticated');
            this.waState = 'authenticating';
            this.latestQrDataUrl = null;
        });

        this.client.on('auth_failure', (msg) => {
            console.error(`[WhatsAppAdapter] Auth failed: ${msg}`);
            this.waState = 'disconnected';
            if (this.errorCb) this.errorCb({ error: new Error(`WhatsApp Auth Blocked: ${msg}`) });
        });

        this.client.on('disconnected', (reason) => {
            console.log('[WhatsAppAdapter] Disconnected:', reason);
            this.waState = 'disconnected';
            this.groupChat = null;
        });

        return new Promise((resolve, reject) => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    console.log('[WhatsAppAdapter] Init timed out — continuing');
                    resolve();
                }
            }, INIT_TIMEOUT_MS);

            this.client.on('ready', async () => {
                settled = true;
                clearTimeout(timeout);
                console.log('[WhatsAppAdapter] Client ready');

                const chats = await this.client.getChats();
                this.groupChat = chats.find(c => c.isGroup && c.name === this.groupName);

                if (this.groupChat) {
                    this.waState = 'connected';
                    console.log(`[WhatsAppAdapter] Listening on group: "${this.groupChat.name}"`);
                } else {
                    console.warn(`[WhatsAppAdapter] Group "${this.groupName}" not found.`);
                    chats.filter(c => c.isGroup).forEach(c => console.log(`  - ${c.name}`));
                }

                // Wire up inbound message handler
                this.client.on('message_create', async (msg) => {
                    if (!this.processInboundMessage) return;
                    await this.processInboundMessage(msg);
                });
                
                resolve();
            });

            clearChromiumLocks('.wwebjs_auth');
            this.client.initialize().catch(e => {
                console.error(`[WhatsAppAdapter] Initialization failure:`, e);
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
        const chat = await msg.getChat();
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
                        messageId: quotedMsg.id._serialized
                    };
                }
            } catch (err) {
                console.warn(`[WhatsAppAdapter] Failed to fetch quoted message data: ${err.message}`);
            }
        }

        const contact = await msg.getContact();
        const sender = contact.pushname || contact.number;
        
        let hasMedia = msg.hasMedia;
        let payload = msg.body.trim();

        if (hasMedia && msg.type === 'ptt' || msg.type === 'audio') {
            try {
                console.log(`[WhatsAppAdapter] Downloading audio message...`);
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
                console.error(`[WhatsAppAdapter] Failed to download audio: ${err.message}`);
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
                console.warn('[WhatsAppAdapter] editMessage: message not found:', messageId);
                return;
            }
        }
        try {
            await msg.edit(text);
        } catch (err) {
            console.error('[WhatsAppAdapter] Edit failed:', err.message);
        }
    }

    async announce(text) {
        if (!this.groupChat) return;
        await this.groupChat.sendMessage(text).catch(() => {});
    }

    onMessage(cb) {
        this.messageCb = cb;
    }

    onError(cb) {
        this.errorCb = cb;
    }
}
