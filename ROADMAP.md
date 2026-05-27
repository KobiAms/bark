# Bark Roadmap

## Phase 1: Foundation (Done ✅)

-   **Thin Core**: EventBus and Plugin Registry.
-   **Adapters**: CLI, Telegram (HTTP Polling), WhatsApp (Web.js).
-   **Drivers**: Claude Code (Stream-JSON), Gemini CLI, OpenCode, Codex, Echo.
-   **Persistence**: JSONL flat-file storage for session and agent registries.
-   **Commands**: `/new`, `/delete`, `/list`, `/switch`, `/restart`, `/stop`.

## Phase 2: Feature Parity (In Progress 🛠)

-   **Slack Adapter**: Full Socket Mode integration for corporate swarms.
-   **Voice Transcription**: Integrated Whisper driver for "Walkie-Talkie" workflow.
-   **Status Pins**: Auto-refreshing status messages for Telegram and Slack showing active agents.
-   **Standups**: `/daily` command to aggregate status updates from all active drivers.
-   **Web UI / Dashboard**: Porting the `bark-pack` dashboard to the modular core for browser-based management.

## Phase 3: Advanced Orchestration (Planned 🚀)

-   **Self-Spawning Agents**: A `spawn-agent` tool for drivers allowing agents to delegate sub-tasks to new sessions.
-   **Shared Tool Registry**: A decentralized tool-discovery system where agents can register and find scripts built by other agents.
-   **Multi-Platform Routing**: Seamlessly move an agent session from WhatsApp to Telegram or the Web UI.
-   **Commander Mode**: A persistent "Master Agent" that manages the swarm's lifecycle and serves as the primary entry point for owners.

## Phase 4: Ecosystem & Scale

-   **Dockerization**: One-command deployment for the entire engine.
-   **Remote Drivers**: Drivers for cloud-hosted LLMs (OpenAI, Anthropic, Google Cloud Vertex).
-   **Agent Market**: Pre-configured agent "personalities" for specific tasks (SRE, Frontend, Documentation).
-   **CLI TUI**: A rich terminal interface for monitoring the event bus in real-time.
