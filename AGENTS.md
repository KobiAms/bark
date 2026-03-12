# Bark — Agent Instructions

## Project
Bark is a Node.js AI agent orchestration monorepo. It routes messages between chat adapters (Telegram, WhatsApp, CLI) and AI driver CLIs (Claude Code, Gemini, Cursor, OpenCode).

See [`README.md`](./README.md) for overview and [`ARCHITECTURE.md`](./ARCHITECTURE.md) for design details.

## Structure
Yarn workspaces under `packages/`:
- `core` — orchestration engine (EventBus, MessageRouter, Registry)
- `adapters/*` — telegram, whatsapp, cli
- `drivers/*` — claude-code, gemini, cursor, opencode, echo, qa
- `storages/*` — jsonl, memory
- `commands/*` — core built-in commands

Examples live in `examples/`. Data persists in `.data/` (git-ignored).

## Setup Skill
[`SETUP.md`](./SETUP.md) is a Claude Code skill (`/setup`). It interviews the user, generates a runtime file under `examples/`, creates a `.env.local.<name>` file with instructions, adds a `yarn start:<name>` script, and launches Bark via `start.sh`.

## Commands
```bash
yarn test              # run tests (vitest)
yarn start:once        # run full-stack example (requires .env)
yarn start:telegram    # run telegram example (requires .env.local.telegram)
yarn start             # run with auto-restart via start.sh
```

## Key Conventions
- ES modules throughout (`"type": "module"`)
- Node 20.6+ — use `node --env-file=<file>` instead of dotenv
- Use `yarn` for all package management — never `npm`
- Each package has zero external deps except `@bark/core` and platform-specific libs
- Drivers wrap a CLI subprocess (node-pty or spawn) — never call APIs directly
- Storage and adapters are pluggable; never hardcode them in packages
- Run tests once using `yarn test --run` (or `CI=true yarn test`) to avoid watch mode staying alive in the background.
