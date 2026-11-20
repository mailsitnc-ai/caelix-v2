# CAELIX CHECKLIST (v2 redesign)

Legend: ✅ proven by a check that ran (self-check `checks/latest.json`: **76/76, 0 errors**, or a live test noted) · 🟡 built but not proven end to end (reason given) · ❌ not built.

Startup: window shown in **~0.45–0.8 s** warm; about 450–480 MB total memory across all Electron processes. First launch after install is slower (~9 s, one-time macOS verification).

## Identity and packaging
- ✅ Named CAELIX in window title, menu, bundle name, package.json and interface.
- ✅ New blue logo used as supplied: `.icns` in `/Applications/CAELIX.app` is byte-identical to the one generated from `assets/source/caelix-icon-blue-original.webp`.
- ✅ Installed at `/Applications/CAELIX.app`, ad-hoc signed.
- 🟡 Desktop shortcut is a symlink `~/Desktop/CAELIX.app` (Finder alias was not permitted).
- ✅ No Claude/Anthropic branding in the UI apart from the words "Import from Claude" on the MCP screen, which reads the user's own Claude config.

## Chat vs Code
- ✅ Chat needs no folder; no permission modes shown; file and shell tools are rejected (engine and UI checks).
- ✅ Chat creates documents in the chat folder: PDF (`%PDF` header verified) and Markdown. Real folder is `~/Documents/CAELIX Chats`; the check used a temporary folder.
- ✅ Code without a folder: composer disabled, "Open a project folder" shown. Opening a folder enables it.
- ✅ Sidebar lists only the current tab's sessions; reopening a Code session restores its folder and messages.
- 🟡 The folder chip of an existing Code session cannot change it (shows a note); not separately tested.

## Context, commands
- ✅ 2,000,000-token window; Context panel shows breakdown (System and memory / Messages / Tool results), note, "Reset chat context" and "Inspect system prompt".
- ✅ `/reset` summarises, keeps memory and returns tokens to baseline; conversation continues with the summary. ✅ Auto-reset at 80% (engine test).
- ✅ `/compact` and `/compat`. ✅ Slash menu lists 37 commands (including /reset, /compat, /btw, /hooks, /mcp).
- 🟡 Not individually checked: /btw side chat, /export, /copy, /fork, /memory, /remember, /init, /skills, /theme, /view, /docs, /files.

## MCP, Hooks, memory
- ✅ MCP screen: built-in `desktop` (4 tools) and `memory` (3 tools), Add & Connect, quick-add chips, Import from Claude, Reconnect all.
- ✅ A stdio MCP server can be added, connects, lists its tool, is called by the model, disabled and removed.
- 🟡 HTTP MCP transport and "Import from Claude" are coded, not exercised against a real server.
- ✅ Hooks screen with presets; Block Force Push preset blocks `git push --force`, lets other commands through; disable and remove work.
- 🟡 Turn Finished Bell and Log Tool Calls presets added the same way but not run. Only PreToolUse blocking is proven; other events fire but were not asserted.
- ✅ Built-in desktop tools (system info, git summary) run; memory saves and finds across chats; saved memories appear in the system prompt.
- ✅ Project memory (AGENTS.md / CAELIX.md) loads; sidebar shows its count.

## Models and keys
- ✅ Keys screen lists all ten providers; keys encrypted, masked to last 4, outside the project (checks).
- ✅ Model picker: search, Refresh, OMNIROUTE (5), favorites (star adds a Favorites group), provider-coloured dots.
- ✅ Live model lists (public endpoints): OpenRouter 477, NVIDIA 33, OpenCode Zen 91, Kilo 471, Nous 413 (earlier live test).
- 🟡 Gemini, Groq, Abliteration need your key; CoArena needs its base URL (none published). Not tested with real keys.
- 🟡 Real token streaming with a live provider is unproven (OpenCode Zen free tier returned HTTP 429 when tried). Streaming is proven against the pretend AI only.
- ✅ OmniRoute routing order by objective; 🟡 provider fallback on error is coded but untested live.
- ✅ Missing-key banner ("Add a … key in Keys or pick a keyless model to send") and Bypass-permissions warning banner.

## Engine and tools (unchanged and re-checked)
- ✅ Streaming, parallel read-only tools and safe Bash, permission modes and pop-up (Allow once / Always / Deny), plan mode blocking writes, rewind, sub-agents, skills, background Bash, Edit rules.
- ✅ Tool cards with Done/Failed/Details, CAELIX message headers with Copy, task list, summary card with Copy summary.
- 🟡 NotebookEdit, WebFetch, WebSearch, AskUserQuestion, ExitPlanMode not exercised by a check.
- ❌ LSP, worktree tools, scheduled tasks, plugins, voice, image attachments, split view, drag-to-arrange panes.
- 🟡 Terminal is a plain shell (no pty).

## Look
- ✅ Blue-black liquid glass (blur, specular edges, glow); v1 layout: top bar (Chat | Code, folder chip, title, mode, Team, model, view, theme, MCP, Hooks, Browser, Keys, panel toggle), sidebar (grouped history with "folder · model", project path, Project memory badge, key note), composer (/ Commands, Agents, mode, model, send), right panel tabs.
- ✅ Light variant renders ("Glacier").
- 🟡 Team chip toggles a "split work across sub-agents" instruction; its effect on a real model is untested.
- 🟡 No pixel comparison against the v1 app was possible (v1 is not run here); the match is by the screenshots you sent.
