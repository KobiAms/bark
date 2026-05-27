import { BarkCore } from '@bark/core';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { CodexDriver } from '@bark/driver-codex';
import { GeminiDriver } from '@bark/driver-gemini';
import { OpenCodeDriver } from '@bark/driver-opencode';
import { CursorDriver } from '@bark/driver-cursor';
import { JsonlStorage, JsonlAgentRegistry } from '@bark/storage-jsonl';
import path from 'path';
import { coreCommands } from '@bark/commands-core';
import { TelegramAdapter } from '@bark/adapter-telegram';
import { WhatsAppAdapter } from '@bark/adapter-whatsapp';
import { WhisperPlugin } from '@bark/plugin-speech-whisper';

async function main() {
    // Prevent silent process exits from unhandled errors
    process.on('uncaughtException', (err) => {
        console.error('[FATAL] Uncaught exception:', err);
        process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('[FATAL] Unhandled rejection at', promise, 'reason:', reason);
        process.exit(1);
    });

    console.log('Initializing Bark Core...');
    const bark = new BarkCore();

    // 1. Storage & Registry
    const dbDir = path.resolve(process.cwd(), '.data');
    bark.useStorage(new JsonlStorage({ filePath: path.join(dbDir, 'sessions.jsonl') }));
    bark.useAgentRegistry(new JsonlAgentRegistry({ filePath: path.join(dbDir, 'agents.jsonl') }));

    // 2. Plugins
    const whisperModel = process.env.WHISPER_MODEL_PATH || '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin';
    bark.usePlugin(new WhisperPlugin({ modelPath: whisperModel }));

    // 3. Drivers
    bark.useDriver('claude', new ClaudeCodeDriver({ model: 'haiku' }));
    bark.useDriver('codex', new CodexDriver());
    bark.useDriver('gemini', new GeminiDriver());
    bark.useDriver('opencode', new OpenCodeDriver());
    bark.useDriver('cursor', new CursorDriver());

    // 3. Adapters
    if (process.env.TELEGRAM_TOKEN) {
        bark.useAdapter('telegram', new TelegramAdapter({
            token: process.env.TELEGRAM_TOKEN,
            stateFile: path.join(dbDir, 'telegram-state.json'),
            allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS?.split(','),
        }));
    }

    if (process.env.WA_GROUP) {
        bark.useAdapter('whatsapp', new WhatsAppAdapter({ groupName: process.env.WA_GROUP }));
    }

    // 4. Commands
    for (const cmd of coreCommands) bark.useCommand(cmd);

    // Graceful shutdown — guard against double-firing (SIGINT + SIGTERM both arrive on Ctrl+C)
    let stopping = false;
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        console.log('\nShutting down Bark...');
        await bark.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await bark.start();
}

main().catch(console.error);
