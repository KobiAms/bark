# Feature Parity: Bark vs. Bark-Pack

This table tracks the transition of features from the legacy `bark-pack` (monolithic script) to the new `bark` (modular core).

| Feature | `bark-pack` (Legacy) | `bark` (Modular Core) | Status |
| :--- | :--- | :--- | :--- |
| **Architecture** | Monolithic (`server.js`) | Plugin-based (`@bark/core`) | ✅ Improved |
| **Multi-Driver Support** | Claude Only | Claude, Gemini, OpenCode, etc. | ✅ New |
| **WhatsApp Adapter** | ✅ | ✅ | ✅ Parity |
| **Telegram Adapter** | ✅ | ✅ | ✅ Parity |
| **Slack Adapter** | ✅ | ❌ | 🛠 Roadmap |
| **Web Chat Adapter** | ✅ | ❌ | 🛠 Roadmap |
| **Voice Messages** | ✅ (Whisper) | ❌ | 🛠 Roadmap |
| **Agent Naming** | Paw Patrol (Automatic) | Custom (Manual) | ✅ Flexible |
| **Process Management** | `tmux`-based | `spawn`-based (Stream JSON) | ✅ Cleaner |
| **Status Pins** | ✅ | ❌ | 🛠 Roadmap |
| **Standups (`/daily`)** | ✅ | ❌ | 🛠 Roadmap |
| **Memory Management** | File-based | Pluggable (Memory, JSONL) | ✅ Improved |
| **Model Selection** | `#haiku` / `#opus` tags | `/switch <driver>` command | ✅ Standardized |
| **Soft Delete / Reborn** | ✅ | ✅ (`/delete` vs `/new`) | ✅ Parity |
| **Multi-Owner Filter** | ✅ | ✅ | ✅ Parity |

## Key Improvements in Bark

1.  **Multi-Model Agnostic**: Bark can bridge a Telegram group to a Gemini agent and a WhatsApp group to a Claude agent simultaneously.
2.  **Developer Experience**: Implementing a new driver or adapter is a matter of following a 4-method interface rather than hacking a central server.
3.  **Performance**: The EventBus architecture allows for high-concurrency event routing without the overhead of `tmux` session management for every small task.
4.  **Extensibility**: Built-in commands are now pluggable middlewares, allowing for custom domain-specific commands (e.g., `/deploy`, `/jira`).
