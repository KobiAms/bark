# Bark Setup Skill

You are helping the user set up and run Bark on their computer. Follow these steps in order.

---

## Step 0 — Prerequisites

Check the Node.js version silently:

```bash
node -v
```

If the version is below **20.6**, stop and tell the user to upgrade — Bark requires Node 20.6+ for native `--env-file` support.

Then run `yarn install` and confirm it completes successfully before continuing. If it fails, troubleshoot the error with the user before moving on.

---

## Step 1 — Detect installed drivers

Run the following commands silently to check what's available on the machine:

```bash
for cmd in claude codex gemini opencode cursor; do
  which $cmd || true
done
```

Report which drivers were found. For each detected driver, suggest a default model:
- `claude` → `sonnet`
- `codex` → no model selection needed
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

If WhatsApp is selected, mention that the first launch will display a QR code in the terminal that they'll need to scan with their phone to authenticate.

---

## Step 3 — Optional plugins

Ask if they want to enable **voice message support** (speech-to-text via Whisper).

Check silently whether the prerequisites are already installed:

```bash
which ffmpeg
(which whisper-cpp || which whisper-cli)
ls /opt/homebrew/share/whisper-cpp/models/ggml-base.en.bin 2>/dev/null || \
ls /usr/local/share/whisper-cpp/models/ggml-base.en.bin 2>/dev/null
```

- If both `ffmpeg` and `whisper-cpp` are found **and** a model file exists, tell the user everything is already in place and confirm they want to enable it.
- If any prerequisite is missing, explain what needs to be installed and offer to install it:

```bash
brew install ffmpeg whisper-cpp
# Detect the Homebrew prefix for cross-arch support
BREW_PREFIX="$(brew --prefix)"
mkdir -p "$BREW_PREFIX/share/whisper-cpp/models/"
curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin \
  -o "$BREW_PREFIX/share/whisper-cpp/models/ggml-base.en.bin"
```

  Run the above only after the user confirms. Wait for it to finish before continuing — the model download is ~140 MB.

If voice support is **enabled**, include `WhisperPlugin` in the runtime file and add `WHISPER_MODEL_PATH` to the env file.
If **skipped**, omit both.

---

## Step 4 — Choose a runtime name

Ask the user for a short name for this setup (e.g. `my-bot`, `dev`, `telegram-claude`). This name is used for the runtime file and env file. It must be a simple kebab-case string.

> Files created: `examples/local.<name>.js` and `.env.local.<name>`

Both are git-ignored.

---

## Step 5 — Generate the runtime file

Build `examples/local.<name>.js` based on the user's selections. Use the existing files in `examples/` as reference for structure and patterns. Store data in `.data/local.<name>/` to keep it isolated from other runtimes.

---

## Step 6 — Generate the env file

Create `.env.local.<name>` at the project root (already git-ignored by the `.env.local*` pattern).

Use `.env.example` as the template — include only the variables needed for the selected adapters and plugins, keeping its comments intact as they explain how to get each value. If Whisper was enabled in Step 3, include `WHISPER_MODEL_PATH`.

If Telegram is selected, always include `TELEGRAM_ALLOWED_USER_IDS` — it is required for security. Explain to the user that without it the bot is open to anyone on Telegram. They can get their user ID by messaging `@userinfobot` on Telegram.

After writing the file, tell the user:
> "Open `.env.local.<name>` and fill in your credentials. The comments explain where to get each value. For Telegram, make sure to fill in `TELEGRAM_ALLOWED_USER_IDS` — message `@userinfobot` on Telegram to get your user ID. Come back and say **done** when ready."

---

## Step 7 — Wait and validate

Wait for the user to confirm the env file is filled (e.g. "done", "ready", "filled it").

Then silently read the env file and check that required variables are non-empty:
- If Telegram was selected: `TELEGRAM_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS` must be set.
- If WhatsApp was selected: `WA_GROUP` must be set.
- If Whisper was enabled: `WHISPER_MODEL_PATH` must be set.

If any required variable is missing or empty, tell the user which ones need to be filled and wait again. Otherwise, confirm everything looks good.

---

## Step 8 — Done

Tell the user setup is complete and give them the command to start Bark:

```
bash start.sh examples/local.<name>.js .env.local.<name>
```

Do **not** run this command — just print it so the user can run it themselves.
