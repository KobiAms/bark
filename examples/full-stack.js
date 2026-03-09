import { BarkCore } from '@bark/core';
import { EchoDriver } from '@bark/driver-echo';
import { ClaudeCodeDriver } from '@bark/driver-claude-code';
import { GeminiDriver } from '@bark/driver-gemini';
import { OpenCodeDriver } from '@bark/driver-opencode';
import { JsonlStorage, JsonlAgentRegistry } from '@bark/storage-jsonl';
import path from 'path';
import { HelpCommand, PingCommand, SwitchDriverCommand, NewCommand, DeleteCommand, ListAgentsCommand, RestartCommand, StopCommand } from '@bark/commands-core';
import { TelegramAdapter } from '@bark/adapter-telegram';
import { WhatsAppAdapter } from '@bark/adapter-whatsapp';

async function main() {
    console.log('Initializing Bark Core...');
    const bark = new BarkCore();

    // 1. Storage & Registry
    const dbDir = path.resolve(process.cwd(), '.data');
    bark.useStorage(new JsonlStorage({ filePath: path.join(dbDir, 'sessions.jsonl') }));
    bark.useAgentRegistry(new JsonlAgentRegistry({ filePath: path.join(dbDir, 'agents.jsonl') }));

    // 2. Drivers
    bark.useDriver('claude', new ClaudeCodeDriver({ model: 'haiku' }));
    bark.useDriver('gemini', new GeminiDriver());
    bark.useDriver('opencode', new OpenCodeDriver());
    bark.useDriver('echo', new EchoDriver());

    // 3. Adapters
    if (process.env.TELEGRAM_TOKEN) {
        bark.useAdapter('telegram', new TelegramAdapter({ token: process.env.TELEGRAM_TOKEN }));
    }

    if (process.env.WA_GROUP) {
        bark.useAdapter('whatsapp', new WhatsAppAdapter({ groupName: process.env.WA_GROUP }));
    }

    // 4. Commands
    bark.useCommand(new HelpCommand());
    bark.useCommand(new PingCommand());
    bark.useCommand(new SwitchDriverCommand());
    bark.useCommand(new StopCommand());
    bark.useCommand(new NewCommand());
    bark.useCommand(new DeleteCommand());
    bark.useCommand(new ListAgentsCommand());
    bark.useCommand(new RestartCommand());

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\nShutting down Bark...');
        await bark.stop();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await bark.start();
}

main().catch(console.error);
