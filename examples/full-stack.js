import { BarkCore } from '@bark/core';
import { CLIAdapter } from '@bark/adapter-cli';
import { EchoDriver } from '@bark/driver-echo';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { MemoryStorage, MemoryAgentRegistry } from '@bark/storage-memory';
import { PingCommand } from '@bark/command-ping';
import { NewCommand, DeleteCommand, ListAgentsCommand, RestartCommand } from '@bark/command-agents';
import { SwitchDriverCommand } from '@bark/command-driver';
import { TelegramAdapter } from '@bark/adapter-telegram';
import { WhatsAppAdapter } from '@bark/adapter-whatsapp';

/**
 * Bootstrap the minimal Bark orchestration layer.
 */
async function main() {
    console.log('Initializing Bark Core...');
    const bark = new BarkCore();

    // 1. Storage & Registry
    console.log('Loading Storage & Registry...');
    bark.useStorage(new MemoryStorage());
    bark.useAgentRegistry(new MemoryAgentRegistry());

    // 2. Drivers (AI plugins)
    console.log('Loading Drivers...');
    bark.useDriver('claude', new ClaudeCodeDriver({ model: 'haiku' })); // Default driver
    bark.useDriver('echo', new EchoDriver());

    // 3. Adapters (Platform plugins)
    console.log('Loading Adapters...');
    const activeAdapters = {};
    
    const cliAdapter = new CLIAdapter();
    bark.useAdapter('cli', cliAdapter);
    activeAdapters.cli = cliAdapter;

    if (process.env.TELEGRAM_TOKEN) {
        const tg = new TelegramAdapter({ token: process.env.TELEGRAM_TOKEN });
        bark.useAdapter('telegram', tg);
        activeAdapters.telegram = tg;
    }

    if (process.env.WA_GROUP) {
        const wa = new WhatsAppAdapter({ groupName: process.env.WA_GROUP });
        bark.useAdapter('whatsapp', wa);
        activeAdapters.whatsapp = wa;
    }

    // 4. Commands (Interceptors)
    console.log('Loading Commands...');
    bark.useCommand(new PingCommand());
    bark.useCommand(new SwitchDriverCommand());
    bark.useCommand(new NewCommand());
    bark.useCommand(new DeleteCommand());
    bark.useCommand(new ListAgentsCommand());
    bark.useCommand(new RestartCommand());

    // Provide a way for the adapter to log back explicitly without looping
    // Note: stream.chunk events are only forwarded to the CLI adapter because Telegram and WhatsApp
    // do not natively support streaming, and send-then-edit is non-trivial. They will only receive 
    // the final text on driver.complete.
    bark.eventBus.subscribe('stream.chunk', (event) => {
        if (event.sessionId.startsWith('cli-') && activeAdapters.cli) {
            activeAdapters.cli.sendMessage(event.sessionId, event.chunk);
        }
    });

    bark.eventBus.subscribe('driver.complete', (event) => {
        if (event.sessionId.startsWith('cli-') && activeAdapters.cli) {
            console.log(); 
            if (activeAdapters.cli.rl) activeAdapters.cli.rl.prompt();
        } else if (event.sessionId.startsWith('wa-') && activeAdapters.whatsapp) {
            activeAdapters.whatsapp.sendMessage(event.sessionId, event.result)
                .catch(err => console.error('[WhatsAppAdapter] Reply failed:', err));
        } else if (event.sessionId.startsWith('tg-') && activeAdapters.telegram) {
            activeAdapters.telegram.sendMessage(event.sessionId, event.result)
                .catch(err => console.error('[TelegramAdapter] Reply failed:', err));
        }
    });

    bark.eventBus.subscribe('command.complete', (event) => {
        if (event.sessionId.startsWith('cli-') && activeAdapters.cli) {
            console.log(); 
            if (activeAdapters.cli.rl) activeAdapters.cli.rl.prompt();
        }
    });

    // Handle graceful shutdown
    const shutdown = async () => {
        console.log('\\nShutting down Bark...');
        await bark.stop();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start everything
    console.log('Starting Bark...');
    await bark.start();
}

main().catch(console.error);
