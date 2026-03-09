import { BarkCore } from '@bark/core';
import { CLIAdapter } from '@bark/adapter-cli';
import { EchoDriver } from '@bark/driver-echo';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { GeminiDriver } from '@bark/driver-gemini';
import { OpenCodeDriver } from '@bark/driver-opencode';
import { JsonlStorage, JsonlAgentRegistry } from '@bark/storage-jsonl';
import path from 'path';
import { PingCommand } from '@bark/command-ping';
import { NewCommand, DeleteCommand, ListAgentsCommand, RestartCommand } from '@bark/command-agents';
import { SwitchDriverCommand } from '@bark/command-driver';
import { TelegramAdapter } from '@bark/adapter-telegram';
import { WhatsAppAdapter } from '@bark/adapter-whatsapp';

function getPlatformId(sessionId) {
    const idx = sessionId.indexOf(':');
    return idx === -1 ? sessionId : sessionId.slice(idx + 1);
}

/**
 * Bootstrap the minimal Bark orchestration layer.
 */
async function main() {
    console.log('Initializing Bark Core...');
    const bark = new BarkCore();

    // 1. Storage & Registry
    const dbDir = path.resolve(process.cwd(), '.data');
    console.log('Loading Storage Plugin...');
    bark.useStorage(new JsonlStorage({ filePath: path.join(dbDir, 'sessions.jsonl') }));
    bark.useAgentRegistry(new JsonlAgentRegistry({ filePath: path.join(dbDir, 'agents.jsonl') }));

    // 2. Drivers (AI plugins)
    console.log('Loading Drivers...');
    bark.useDriver('claude', new ClaudeCodeDriver({ model: 'haiku' })); // Default driver
    bark.useDriver('gemini', new GeminiDriver());
    bark.useDriver('opencode', new OpenCodeDriver());
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

    // Maps agent sessionId → platform sessionId for reply routing.
    // Agents have a single shared context regardless of which adapter invoked them.
    // The originating platform session is tracked here so replies go back to the right place.
    const agentReplyTo = new Map();

    bark.eventBus.subscribe('stream.chunk', (event) => {
        const replyTo = agentReplyTo.get(event.sessionId) || event.sessionId;
        if (getPlatformId(replyTo).startsWith('cli-') && activeAdapters.cli) {
            activeAdapters.cli.sendMessage(replyTo, event.chunk);
        }
    });

    bark.eventBus.subscribe('driver.thinking', (event) => {
        if (event.replyTo) agentReplyTo.set(event.sessionId, event.replyTo);
        const replyTo = agentReplyTo.get(event.sessionId) || event.sessionId;
        const platformId = getPlatformId(replyTo);
        if (platformId.startsWith('wa-') && activeAdapters.whatsapp) {
            activeAdapters.whatsapp.sendMessage(replyTo, '⏳ _thinking..._')
                .catch(() => {});
        } else if (platformId.startsWith('tg-') && activeAdapters.telegram) {
            activeAdapters.telegram.sendMessage(replyTo, '⏳ _thinking..._')
                .catch(() => {});
        }
    });

    bark.eventBus.subscribe('driver.complete', (event) => {
        const replyTo = agentReplyTo.get(event.sessionId) || event.sessionId;
        const platformId = getPlatformId(replyTo);
        if (platformId.startsWith('cli-') && activeAdapters.cli) {
            console.log();
            if (activeAdapters.cli.rl) activeAdapters.cli.rl.prompt();
        } else if (platformId.startsWith('wa-') && activeAdapters.whatsapp) {
            activeAdapters.whatsapp.sendMessage(replyTo, event.result)
                .catch(err => console.error('[WhatsAppAdapter] Reply failed:', err));
        } else if (platformId.startsWith('tg-') && activeAdapters.telegram) {
            activeAdapters.telegram.sendMessage(replyTo, event.result)
                .catch(err => console.error('[TelegramAdapter] Reply failed:', err));
        }
    });

    bark.eventBus.subscribe('command.complete', (event) => {
        const platformId = getPlatformId(event.sessionId);
        if (platformId.startsWith('cli-') && activeAdapters.cli) {
            console.log();
            if (activeAdapters.cli.rl) activeAdapters.cli.rl.prompt();
        } else if (platformId.startsWith('wa-') && activeAdapters.whatsapp) {
            activeAdapters.whatsapp.sendMessage(event.sessionId, event.result)
                .catch(err => console.error('[WhatsAppAdapter] Command reply failed:', err));
        } else if (platformId.startsWith('tg-') && activeAdapters.telegram) {
            activeAdapters.telegram.sendMessage(event.sessionId, event.result)
                .catch(err => console.error('[TelegramAdapter] Command reply failed:', err));
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
