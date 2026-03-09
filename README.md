# Bark

Bark is a lightweight, framework-agnostic AI agent orchestration engine. It provides a purely decoupled "thin core" for routing events between communication platforms (Adapters) and AI runtimes (Drivers).

## Features
- **Zero Coupling**: The core engine (`@bark/core`) has no dependencies on specific databases, LLMs, or chat platforms.
- **Pluggable Architecture**: Everything is an Extension obeying strict interfaces (`IAdapter`, `IDriver`, `IStorage`, `ICommand`).
- **Bi-Directional Streaming**: Supports real-time text chunk routing through the EventBus architecture.

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

### Storage & Interceptors
- `@bark/storage-memory` - In-memory ephemeral session state.
- `@bark/command-ping` - Simple `/ping` response interceptor.
- `@bark/command-driver` - Chat-based dynamic driver switching (e.g. `/driver claude`).

## Quick Start
To run the full stack example tying all these modules together:
```bash
# Clone the repo and install dependencies
git clone https://github.com/your-username/bark.git
cd bark
yarn install

# Execute the pre-built multi-adapter example 
TELEGRAM_TOKEN="your_token" WA_GROUP="Bark Devs" node examples/full-stack.js
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
See [CONTRIBUTING.md](./CONTRIBUTING.md) for details on our open source workflow.
