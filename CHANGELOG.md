# Bark Architecture & Project Handover

This changelog serves as a handover document summarizing all the features, architectural decisions, and driver integrations added to the Bark Multi-Agent Engine up to this point.

## 🚀 Key Features

### 1. Robust Multi-Agent Orchestration
We completely pivoted from a single-agent chat paradigm to a **Dynamic Multi-Agent System**. 
- **`IAgentRegistry`**: A dedicated registry layer that links personalities (`systemPrompt`), names, and their execution engines (`driverName`).
- **Dynamic Spawning & Despawning**: You can dynamically spawn an agent explicitly into a chat thread using `/new <name> --driver <driver> --prompt <instructions>`, and remove it with `/delete <name>`.
- **Lexical and Contextual Routing**: 
  - **Mentioning**: Sending a message starting with `@AgentName` routes your text directly to that specific agent, isolating its conversation history from others.
  - **Reply Routing**: Instead of repeatedly citing `@AgentName`, users can natively swipe/reply to a specific agent's previous message in platforms like WhatsApp or Telegram, and the `MessageRouter` will automatically pipe the dialogue to that agent.

### 2. Multi-Driver Ecosystem
Bark relies entirely on standard interfaces (`IDriver`). This enabled us to integrate multiple distinct underlying AI runtimes that operate in the exact same chat simultaneously:
- **`@bark/driver-claude-code`**: The default engine. Supports stateful resuming via deterministic UUIDs, natively tracking multi-turn conversations through the `claude-code` local SQLite databases.
- **`@bark/driver-gemini`**: Integrates the Google `gemini` CLI in headless mode (`--approval-mode auto_edit`). Provides a stateless executor that is fully transparent to Bark.
- **`@bark/driver-opencode`**: Integrates the `opencode` CLI, leveraging its rich `--session` resuming feature for contextual continuity across different tasks.
- **`@bark/driver-echo`**: A simple testing fallback driver.
- *Any combination of these models can converse inside the same chat without state contamination.*

### 3. "Zero-Config" JSONL Persistence
We established flat-file persistence as a first-class feature so that users don't need a heavy database (like Chroma or Postgres) to save agents.
- **`@bark/storage-jsonl`**: A persistent, file-based `.jsonl` system holding `agents.jsonl` and `sessions.jsonl`.
- If the node process crashes or the user hits `/restart`, Bark seamlessly rebuilds all agent personalities, memories, and driver attachments on the next boot, meaning nothing is ever lost.

### 4. Modular Adapters & UX Enhancements
- **WhatsApp (`@bark/adapter-whatsapp`)**: Capable of reading mentions, routing replies, and ignoring `fromMe` bot loops while letting manual human CLI overrides pass through.
- **Commands API**: Extensible command plugins dynamically handle system operations. For example, the `/restart` command (`@bark/command-agents/restart.js`) issues an intentional `process.exit(0)`, which triggers your process manager (like PM2 or nodemon) to cleanly restart the platform during live development.

## 📁 Monorepo Structure

- **`packages/core/`**: The `EventBus`, `ExtensionRegistry`, `LifecycleManager`, and `MessageRouter`. Interfaces are defined here.
- **`packages/command-*/`**: Plugin commands for `/ping`, `/new`, `/delete`, `/agents`, `/driver`.
- **`packages/driver-*/`**: AI engines implementation (Claude, Gemini, OpenCode). 
- **`packages/adapter-*/`**: Frontend platform integrations (WhatsApp, Telegram, Headless CLI).
- **`packages/storage-*/`**: Persistence layer implementations (Memory, JSONL).
- **`examples/full-stack.js`**: The production-ready entry point that binds everything together. 

## 📝 Recent Commits Overview

- `feat(drivers): Implementing @bark/driver-gemini and @bark/driver-opencode`
- `Untrack .data directory`
- `Revert fromMe fix in WhatsAppAdapter and ignore .data directory` (Bot detection relies on invisible string characters rather than broad `fromMe` blocking that breaks self-hosted testing).
- `Fix dropped messages in WhatsAppAdapter due to unmerged processInboundMessage logic`
- `Implement JSONL Persistent Storage`
- `Implement UX Refinements: Reply routing, /new rename, and /restart command`
- `Refactor terminology: Replace 'pup' with 'agent'`
- `Restore multi-turn session persistence in ClaudeCodeDriver using stable UUIDs and --resume logic`

## 🛠 Handover Notes for Next Developer
1. **Adding RAG / Storage API**: For future Retrieval Augmented Generation (RAG) expansions, consider adding an `IEveStorage` or `IVectorStorage` to the Core interfaces.
2. **Gemini Stateful History**: `@bark/driver-gemini` is currently executing headless prompts seamlessly but runs statelessly. Since the Gemini CLI relies purely on indices (`--resume 2`) rather than UUIDs, you'll need to explore its SQLite implementation or use ACP/Context files to safely support interleaved multi-turn interactions.
3. **WhatsApp Protocol Errors**: If the Chromium instance hangs, `examples/full-stack.js` may throw a `ProtocolError`. Run `killall "Google Chrome Helper"` to release ghost instances, or simply let `/restart` handle it.
4. **Environment**: `whatsapp-web.js` does not require user interactions when run in production, but if auth drops, you'll need the QR scan again. Keep `.wwebjs_auth` safely cached.
