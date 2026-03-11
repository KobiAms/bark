# Bark Setup Skill

You are helping the user set up and run Bark on their computer. Follow these steps in order.

---

## Step 1 — Detect installed drivers

Run the following commands silently to check what's available on the machine:

```bash
which claude
which gemini
which opencode
which cursor
```

Report which drivers were found. For each detected driver, suggest a default model:
- `claude` → `sonnet`
- `gemini` → `gemini-2.5-pro`
- `opencode` / `cursor` → no model selection needed

Ask the user to confirm the selection or change any models. A simple "yes" accepts all defaults.

---

## Step 2 — Choose adapters

Ask which chat platforms they want to connect:
- Telegram
- WhatsApp
- Both
- Neither (CLI only)

---

## Step 3 — Generate the runtime file

Name the file using the selected adapters and drivers as components, prefixed with `local.` so it is git-ignored:

> Format: `examples/local.<adapters>-<drivers>.js`
> Lives alongside the other examples in `examples/`

Build the file based on the user's selections. Use the existing files in `examples/` as reference for structure and patterns. Store data in `.data/local.<adapters>-<drivers>/` to keep it isolated from other runtimes.

---

## Step 4 — Generate the env file

Create `.env.local.<adapters>-<drivers>` at the project root (already git-ignored by the `.env.local*` pattern).

Use `.env.example` as the template — include only the variables needed for the selected adapters, keeping its comments intact as they explain how to get each value.

After writing the file, tell the user:
> "Open `.env.local.<name>` and fill in your credentials. The comments explain where to get each value. Come back and say **done** when ready."

---

## Step 5 — Wait for confirmation

Wait for the user to confirm the env file is filled (e.g. "done", "ready", "filled it").

---

## Step 6 — Run

Launch Bark directly using the Bash tool — no package.json changes needed:

```bash
bash start.sh examples/local.<name>.js .env.local.<name>
```
