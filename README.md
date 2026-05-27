# Bark

Bark is a lightweight, framework-agnostic AI agent orchestration engine. It provides a purely decoupled "thin core" for routing events between communication platforms (Adapters) and AI runtimes (Drivers).

## Features
- **Zero Coupling**: The core engine (`@bark/core`) has no dependencies on specific databases, LLMs, or chat platforms.
- **Pluggable Architecture**: Everything is an Extension obeying strict interfaces (`IAdapter`, `IDriver`, `IStorage`, `ICommand`).
- **Bi-Directional Streaming**: Supports real-time text chunk routing through the EventBus architecture.
- **Project Vision**: Read about our [Inspiration](./INSPIRATION.md), [Feature Parity](./PARITY.md), and [Roadmap](./ROADMAP.md).

## Packages
### Core
- `@bark/core` - The thin orchestration engine, EventBus, and Lifecycle Manager.

### Adapters (Platforms)
- `@bark/adapter-cli` - Interactive local terminal testing.
- `@bark/adapter-telegram` - Telegram Bot integration natively using HTTP polling.
- `@bark/adapter-whatsapp` - WhatsApp Web integration via `whatsapp-web.js`.

### Drivers (AI)
- `@bark/driver-echo` - Mock loopback driver for testing.
- `@bark/driver-claude-code` - Integration with Anthropic's Claude CLI.
- `@bark/driver-codex` - Integration with OpenAI's Codex CLI.
- `@bark/driver-gemini` - Integration with Google's Gemini CLI.
- `@bark/driver-opencode` - Integration with the OpenCode CLI.
- `@bark/driver-cursor` - Integration with the Cursor CLI.

### Storage
- `@bark/storage-memory` - In-memory ephemeral session state.
- `@bark/storage-jsonl` - Persistent JSONL file-based session storage.

### Commands
- `@bark/commands-core` - Built-in chat commands:
  - `/ping` — health check
  - `/switch <driver>` — switch the active AI driver (e.g. `/switch gemini`)
  - `/new <name> [driver]` — create a named agent
  - `/delete <name>` — delete an agent
  - `/list` — list all agents and their drivers
  - `/restart` — restart Bark Core in place
  - `/stop` — stop the current agent's active session
  - `/compact` — summarize and compress the session history

## Quick Start

The easiest way to get started is the interactive setup skill. Open this repo in Claude Code and run:

```
/setup
```

It will interview you about which adapters and drivers you want, generate a ready-to-run config, and launch Bark for you. See [`SETUP.md`](./SETUP.md) for details.

**Manual setup:**
```bash
yarn install
node --env-file=.env examples/full-stack.js
```

## Creating Extensions
To add a new platform or driver, simply implement the corresponding interface and register it with the BarkCore registry:
```javascript
import { BarkCore, IAdapter } from '@bark/core';

class CustomAdapter extends IAdapter { ... }

const bark = new BarkCore();
bark.useAdapter('custom', new CustomAdapter());
bark.start();
```

## Contributing
See [ARCHITECTURE.md](./ARCHITECTURE.md) for design details and extension guidelines.
