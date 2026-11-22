<div align="center">

<img src="assets/icons/icon-256.png" alt="CAELIX" width="128" height="128">

# CAELIX

**A desktop coding agent with a blue-and-black liquid-glass interface.**
Chat with models for anything, or point it at a project folder and let it read, edit and run code, on your own provider keys.

[Download](#download) · [Features](#features) · [Providers](#model-providers) · [Updating](#updating) · [Build from source](#build-from-source)

</div>

> **A learning project.** CAELIX was built from scratch to learn how a terminal coding agent and its desktop app work. It contains no code or prompts copied from any other product, and it is not affiliated with or endorsed by any model provider. Provider names are used only to say which services you can connect.

---

## Download

Get the file for your computer from the [latest release](https://github.com/mailsitnc-ai/caelix-v2/releases/latest).

| Your computer | File |
|---|---|
| Mac with Apple Silicon (M1, M2, M3, M4 and newer) | `CAELIX-<version>-mac-arm64.dmg` |
| Mac with an Intel chip | `CAELIX-<version>-mac-x64.dmg` |
| Windows 10 or 11 (64-bit) installer | `CAELIX-<version>-win-x64-Setup.exe` |
| Windows, no install (unzip and run) | `CAELIX-<version>-win-x64-portable.zip` |

Not sure which Mac you have? Apple menu → **About This Mac**. "Chip: Apple M…" means Apple Silicon; "Processor: Intel…" means Intel.

Every file is listed with its SHA-256 checksum in `SHA256SUMS.txt` on the release page, so you can check that your download is intact:

```bash
shasum -a 256 CAELIX-*-mac-arm64.dmg      # Mac
```
```powershell
Get-FileHash .\CAELIX-*-win-x64-Setup.exe -Algorithm SHA256   # Windows
```

### First launch on a Mac

1. Open the `.dmg` and drag **CAELIX** onto **Applications**.
2. CAELIX is not notarized by Apple (that needs a paid developer account), so macOS will warn you the first time. **Right-click CAELIX in Applications → Open → Open.** You only do this once.
3. If macOS says the app is **"damaged"** (this happens to downloaded apps without notarization), run this once in Terminal, then open it again:

```bash
xattr -cr /Applications/CAELIX.app
```

### First launch on Windows

1. Run the Setup file. It installs for your user only and does not need administrator rights. It adds a Start menu entry and a Desktop shortcut.
2. Windows SmartScreen may say "Windows protected your PC" because the installer is not code-signed. Click **More info → Run anyway**.
3. The portable zip needs no installer: unzip it anywhere and run `CAELIX.exe`.

### First steps

1. Open **Keys** (top right) and paste a key for any provider you use. Or skip this: **Kilo Gateway** and **OpenCode Zen** are built in and offer free models with no key.
2. Pick a model with the model chip at the bottom of the message box.
3. Say hello. For code, switch to the **Code** tab and open a project folder.

---

## Features

### Chat and Code, kept separate

- **Chat** needs no folder and never touches your files. It can search the web, fetch pages, keep a to-do list, ask you questions, and create documents (PDF or Markdown) in `Documents/CAELIX Chats`.
- **Code** works inside a project folder you choose. Every new Code session starts by choosing a folder (your recent folders are one click away). An old session reopens in the folder it started in.
- The sidebar shows the sessions of the tab you are on, grouped by day, searchable, with rename, pin, archive and delete.

### The agent

- Streams replies as they arrive, runs tools, feeds the results back and repeats until the job is done.
- **Tools:** read, write, exact-string edit, notebook edit, glob, grep, shell commands (foreground and background, with timeouts), web fetch, web search, task list, ask-the-user, sub-agents, skills, and every tool from connected MCP servers.
- **Parallel by default:** tools that do not depend on each other (reads, searches, safe shell commands) run at the same time. Edits run in order.
- **Permission modes:** Manual, Accept edits, Plan, Auto and Bypass permissions, with allow / ask / deny rules per tool and pattern. A pop-up offers Allow once, Always or Deny.
- **Checkpoints and rewind:** every prompt is a checkpoint. Undo the file changes of any earlier prompt, and optionally the conversation too.
- **Changes panel** (diff of every edited file), a **terminal**, a **browser** and a **file browser** in the right-hand panel.
- **Project memory:** `CAELIX.md` or `AGENTS.md` in a project is read at the start of each session. `/remember` saves notes that follow you across chats.

### A 2,000,000-token context

- A live token meter, and a Context panel that breaks usage into system and memory, messages and tool results.
- **`/reset`** summarises the whole conversation, keeps memory, and returns the count to the starting point. It also runs **automatically at 80%** so a long job never hits a wall.
- **`/compact`** (also `/compat`) summarises only older messages and keeps the recent ones.

### Images

Paste an image, drag it onto the message box, or use **+ → Attach image**. Up to 6 per message; large pictures are shrunk to 1568 px before sending. Use a model that can see images (for example one with "vl", "vision" or "omni" in its name). CAELIX warns you when the model probably cannot.

### Team mode (Code)

Choose two models: a **coder** that does the work and a **reviewer** that reads what changed. If the reviewer answers `CHANGES NEEDED`, the coder gets one pass to fix the points. Open it from the **Team** chip or with `/team`.

### Chats name themselves

A new chat gets a tidy name from your first message straight away, and a short model-written title after the first reply. Rename any chat yourself from the title, the sidebar menu or `/rename`; a name you set is never overwritten.

### MCP, hooks, skills and sub-agents

- **MCP:** add stdio or HTTP servers, import your existing server list, enable, disable and reconnect. Built-in servers give you system information, a Git summary, open ports, the clipboard, and a memory store.
- **Hooks:** run your own commands on `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SessionStart`, `PreCompact` and `Notification`. Exit code 2 blocks the action. Presets include *Block Force Push*.
- **Skills:** reusable instructions in `.caelix/skills`.
- **Sub-agents:** hand a side task to a read-only explorer or a full worker.

### Commands

Type `/` in the message box. The full list:

`/reset` `/compact` `/compat` `/btw` `/clear` `/new` `/chat` `/code` `/model` `/mode` `/plan` `/team` `/agents` `/rename` `/rewind` `/diff` `/terminal` `/browser` `/files` `/context` `/cost` `/memory` `/remember` `/init` `/export` `/copy` `/skills` `/hooks` `/mcp` `/keys` `/settings` `/system` `/docs` `/fork` `/theme` `/view` `/help`

`/btw` asks a side question in a small window without disturbing the main conversation.

### Look

Blue-and-black liquid glass (blur, soft glow, specular edges), with a light "Glacier" variant. Opens in about a second on a warm start.

---

## Model providers

Bring your own keys. CAELIX talks to every provider through the same OpenAI-style chat protocol.

| Provider | Key needed? | Notes |
|---|---|---|
| **Google Gemini** | Yes | Model list loads from your key |
| **OpenRouter** | Yes | Hundreds of models; free `:free` models exist. Requests are capped at 8,192 output tokens so low credit balances still work |
| **NVIDIA NIM** | Yes | Many catalog models are not callable on every account; use **Check models** |
| **Groq** | Yes | Fast inference |
| **CoArena** | Yes | `https://coarena.ai` |
| **Kilo Gateway** | **No** (optional) | Free models work without a key |
| **OpenCode Zen** | **No** (optional) | Free models work without a key; the free tier is rate-limited per network |
| **Numes** | Yes | `https://numes.ai` |
| **Abliteration AI** | Yes | |
| **OmniRoute** | No | A router that picks a connected model for you: `auto`, `auto/coding`, `auto/fast`, `auto/cheap`, `auto/smart` |

**OmniRoute** scores the models of every connected provider for the objective you chose and tries them in order. If one fails it moves on to the next, remembers what failed, and prefers the model that last worked. Models that return "not found", "needs credits" or "no access" are set aside for hours instead of being retried on every step. You can also point it at a self-hosted OmniRoute server.

**Check models** (Keys screen) sends a tiny test message to every model on your key and shows which ones work. The ones that cannot work on your account go to an **Archived** section at the bottom of the model picker, with the reason and date. They come back by themselves when a later check finds them working, or one at a time with **Restore**. You can also run the check without opening the app:

```bash
# macOS
/Applications/CAELIX.app/Contents/MacOS/CAELIX --probe all
# results are written as probe-<provider>.json in the CAELIX data folder
```

### Where your data lives

| | macOS | Windows |
|---|---|---|
| Sessions, notes, settings, encrypted keys | `~/Library/Application Support/CAELIX v2` | `%APPDATA%\CAELIX v2` |
| Chat documents | `~/Documents/CAELIX Chats` | `Documents\CAELIX Chats` |

**Keys** are encrypted with your operating system's secure storage (macOS Keychain, Windows DPAPI), kept outside every project folder, and shown only as the last four characters. They are sent only to the provider they belong to. CAELIX sends no telemetry.

---

## Updating

Click the **⟳** button in the top bar (or **CAELIX → Check for Updates…** on a Mac). CAELIX looks at this repository, tells you what changed, and **Update now** downloads the newest app code and restarts. You never need to download the installer again.

- A green dot on the button appears by itself when a newer version exists. CAELIX checks a few seconds after it starts and every four hours after that.
- Your chats, keys and settings are not touched.
- The update replaces the app's code (the interface, the agent engine, the providers) but not the Electron runtime shipped in the installer. If a future version ever needs a newer runtime, CAELIX tells you to download a fresh installer.
- Before installing, CAELIX checks that the download really is CAELIX and is complete. If a downloaded version fails to start, CAELIX falls back to the installed one by itself.
- A newer installer always wins over older downloaded code, so installing a fresh download never leaves you on stale code.

---

## Self-check

CAELIX has a test mode in which a built-in pretend model (no key needed) drives the real app end to end, then closes:

```bash
npm install          # downloads the Electron runtime
npm run selfcheck
```

It runs more than a hundred checks (start time, Chat vs Code, permissions, documents, `/reset` and auto-reset, MCP, hooks, routing, the model picker, images, Team mode, renaming, the updater and more), saves screenshots, errors, the start time and memory use to `checks/`, and exits non-zero if anything fails.

---

## Build from source

You need [Node.js](https://nodejs.org) 20 or newer. The app is plain HTML, CSS and JavaScript: no bundler and nothing to compile.

```bash
git clone https://github.com/mailsitnc-ai/caelix-v2.git
cd caelix-v2
npm install        # installs the Electron runtime only
npm start          # run the app
npm run selfcheck  # run the self-check
```

Terminal mode (no window):

```bash
node bin/caelix.js -p "summarise this folder" --provider kilo --model "nvidia/nemotron-3.5-lightning:free" --output-format text
```
Keys for terminal mode come from environment variables such as `CAELIX_KEY_OPENROUTER`.

### Make installers

```bash
node scripts/package.js --install          # build and install the app on this Mac
node scripts/release.js --only mac-arm64   # a .dmg for this Mac
```

`scripts/release.js` also builds the Intel Mac and Windows downloads from the official Electron runtimes (`--mac-x64-zip` and `--win-x64-zip`), writes `SHA256SUMS.txt`, and uses `makensis` for the Windows installer. Icons are made from `assets/source/caelix-icon-minimal-original.webp` by `scripts/make-icons.py`.

### How it is organised

```
boot.js              tiny loader: runs the installed code or a newer downloaded copy
main.js              Electron main process: windows, sessions, keys, IPC
preload.js           the safe bridge between the window and main.js
renderer/            the interface (index.html, styles.css, app.js, modals.js, panes.js, md.js)
src/engine/          agent loop, tools, permissions, providers, MCP, hooks, memory, sessions
src/updater.js       the update checker and installer
src/selfcheck.js     the self-check
bin/caelix.js        terminal mode
scripts/             icons, packaging, release builder, installer script
assets/              icons and the logo sources
```

---

## Known limits

- The Mac app is signed ad hoc, not notarized, and the Windows installer is not code-signed, so both show a first-launch warning (see above).
- The Windows builds are assembled from the official Electron runtime on a Mac and were not run on a Windows machine before release. Please report problems.
- Not built yet: language-server integration, worktree tools, scheduled tasks, plugins, voice input, split view and drag-to-arrange panels. The built-in terminal is a plain shell, not a full pseudo-terminal.
- Live streaming has been tried end to end with NVIDIA NIM (through OmniRoute) and Kilo Gateway. The other providers share the same code path but were not all tested with live keys, and they depend on your key and their limits.

## Contributing and issues

Found a bug or have an idea? [Open an issue](https://github.com/mailsitnc-ai/caelix-v2/issues). When you report a problem, `checks/latest.json` from `npm run selfcheck` is the most helpful thing to attach.
