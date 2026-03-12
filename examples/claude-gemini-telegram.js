import { BarkCore } from '@bark/core';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { GeminiDriver } from '@bark/driver-gemini';
import { JsonlStorage, JsonlAgentRegistry } from '@bark/storage-jsonl';
import path from 'path';
import { HelpCommand, PingCommand, SwitchDriverCommand, NewCommand, DeleteCommand, ListAgentsCommand, RestartCommand, StopCommand, CompactCommand, ModelsCommand } from '@bark/commands-core';
import { TelegramAdapter } from '@bark/adapter-telegram';
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

    const bark = new BarkCore();

    // 1. Storage & Registry
    const dbDir = path.resolve(process.cwd(), '.data', 'telegram');
    bark.useStorage(new JsonlStorage({ filePath: path.join(dbDir, 'sessions.jsonl') }));
    bark.useAgentRegistry(new JsonlAgentRegistry({ filePath: path.join(dbDir, 'agents.jsonl') }));

    // 2. Plugins
    const whisperModel = process.env.WHISPER_MODEL_PATH || '/opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin';
    bark.usePlugin(new WhisperPlugin({ modelPath: whisperModel }));

    // 3. Drivers
    bark.useDriver('claude', new ClaudeCodeDriver({ model: 'sonnet' }));
    bark.useDriver('gemini', new GeminiDriver());

    // 4. Adapters
    bark.useAdapter('telegram', new TelegramAdapter({
        token: process.env.TELEGRAM_TOKEN,
        stateFile: path.join(dbDir, 'telegram-state.json'),
        allowedUserIds: process.env.TELEGRAM_ALLOWED_USER_IDS?.split(','),
    }));

    // 5. Commands
    bark.useCommand(new HelpCommand());
    bark.useCommand(new PingCommand());
    bark.useCommand(new SwitchDriverCommand());
    bark.useCommand(new StopCommand());
    bark.useCommand(new CompactCommand());
    bark.useCommand(new NewCommand());
    bark.useCommand(new DeleteCommand());
    bark.useCommand(new ListAgentsCommand());
    bark.useCommand(new RestartCommand());
    bark.useCommand(new ModelsCommand());

    // Graceful shutdown
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
