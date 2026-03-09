# Proposal: Bark Web GUI & Back Office

This document outlines the architectural plan for adding a GUI to Bark that serves as both an interaction endpoint (Adapter) and a management dashboard (Back Office).

## 🎯 Objectives
1.  **Frictionless Setup**: A standalone web dashboard that runs locally alongside the Bark core.
2.  **Web Interaction**: A new `@bark/adapter-web` to allow chatting with agents directly via browser.
3.  **Visual Management**: A "Back Office" to manage agent personalities, view logs, and monitor drivers.

---

## 🏗 Architectural Approach

### 1. The `@bark/adapter-web` (The Bridge)
Instead of the current adapters (WhatsApp/Telegram) which talk to external APIs, this adapter will host a local **WebSocket server** (Socket.io) and an **Express/Fastify** API.

- **Role**: It acts as the "Server" for the Frontend.
- **Inbound**: Listens for `chat.message` from the browser and emits `message.received` into the Bark `EventBus`.
- **Outbound**: Subscribes to `stream.chunk` and `driver.complete` from the `EventBus` and pushes them to the browser via WebSockets.

### 2. The Frontend Dashboard (The Interface)
A **React/Vite** application that connects to the Web Adapter.

#### **A. Chat Interface (Adapter UI)**
- A modern, "Claude-like" or "WhatsApp-like" chat window.
- Supports the standard `@mention` flow and "Reply-to" visuals.

#### **B. Back Office (System Admin)**
- **Agent Registry Page**: A visual table of all `/new` agents.
  - Buttons to edit `systemPrompt` or change `driver` (Claude -> Gemini).
  - "Delete" buttons (triggering `/delete`).
- **Log Viewer**: Real-time tailing of the `sessions.jsonl` and `agents.jsonl` files.
- **Driver Monitoring**: See which drivers are currently "active" or "errored".

---

## 💻 Tech Stack Recommendation
- **Backend Core Integration**: [Socket.io](https://socket.io/) + [Express](https://expressjs.com/).
- **Frontend Framework**: [React](https://react.dev/) + [Vite](https://vitejs.dev/).
- **Styling**: [Vanilla CSS](https://developer.mozilla.org/en-US/docs/Web/CSS) (keeping with Bark's minimalist, high-performance philosophy).
- **Communication**: JSON-RPC over WebSockets.

---

## 🛠 Ease of Setup
To achieve "easy setup on a new computer," we can bundle the frontend build specifically:
1.  **Monorepo Integration**: Add `bark web` as a CLI command.
2.  **Single Process**: The `WebAdapter` will serve the static build of the React app. When the user runs `yarn start`, it opens `localhost:3000` automatically.
3.  **Zero Database**: It continues using the `.data/` JSONL storage, so there's no SQL/NoSQL to install.

---

## ❓ Discussion Points
1.  **The "Back Office" permissions**: Since it runs locally, should we include a simple password/token system for the web interface?
2.  **Shared Memory**: Should the Web GUI see the *same* sessions as WhatsApp? (Current architecture says YES, since the sessionId is the unique key).
3.  **Self-Correction**: Should the GUI allow "restarting" the node process directly from a button?
