# CAELIX CHECKLIST

Legend: ✅ proven by a check that ran (self-check `checks/latest.json`, 44/44 passing, or a live test noted) · 🟡 built but not proven end to end (reason given) · ❌ not built.

Self-check result: **44/44 checks, 0 errors**, window shown in **~0.5–1.0 s** (warm), about 450–490 MB total memory (all Electron processes). First launch after install was ~9 s (one-time Electron download and macOS verification).

## Identity and packaging
- ✅ Named CAELIX in window title, menu, bundle (`CFBundleName`), package.json, interface (check: title, plist).
- ✅ Supplied icon used as-is: `.icns` in `/Applications/CAELIX.app` is byte-identical to `assets/icons/icon.icns` (cmp).
- ✅ Installed to `/Applications/CAELIX.app`, ad-hoc signed (`codesign -v` OK), launches (process started).
- 🟡 Desktop shortcut: a symlink `~/Desktop/CAELIX.app` (Finder alias creation was not permitted). Dock icon uses the same bundle icon; not eyeballed in the Dock.
- ✅ No Claude/Anthropic branding in the UI; names appear only inside provider model lists.

## Providers and models
- ✅ Keys screen lists all ten: Gemini, OpenRouter, NVIDIA NIM, Groq, CoArena, Kilo Gateway, OpenCode Zen, Nous, Abliteration AI, OmniRoute.
- ✅ Keys encrypted (Electron safeStorage), outside the project folder, masked to last 4, no plaintext on disk (checks).
- ✅ Model lists load live: OpenRouter 477, NVIDIA 33, OpenCode Zen 91, Kilo 471, Nous 413 (public endpoints, live test).
- 🟡 Gemini, Groq, Abliteration lists need your key (return a clear error without one); not tested with a real key.
- 🟡 CoArena: its endpoint could not be found online, so its base URL is a field you fill in. Untested.
- 🟡 Real token streaming against a live provider not proven: OpenCode Zen answered a free-tier rate limit (HTTP 429), which the app reported correctly. The streaming parser is proven only against the pretend AI.
- ✅ OmniRoute picker shows `OMNIROUTE (5)`: auto, auto/coding, auto/fast, auto/cheap, auto/smart (screenshot `10-model-picker.png`).
- ✅ OmniRoute routing order by objective (fast→Groq instant, cheap→free, coding→coder, smart→strong, none→no candidates).
- 🟡 OmniRoute fallback across providers on error is coded but untested with real providers.
- ❌ The real Claude Code engine option was dropped at your request.

## Engine and tools
- ✅ Agent loop streams text word by word; independent read-only tools and safe Bash run together.
- ✅ Read, Write, Edit (read-first, unique-match rules), Glob, Grep, Bash (including background), TodoWrite, Agent (sub-agent), Skill, MCP tools, hooks (CLI test + self-check).
- 🟡 NotebookEdit, WebFetch, WebSearch, AskUserQuestion, EnterPlanMode/ExitPlanMode, TaskStop: implemented, not exercised by a check.
- ❌ LSP, worktree tools, scheduled tasks (Cron*, ScheduleWakeup), PushNotification tool, Artifact tools, plugins.
- ✅ Permission modes Manual, Accept edits, Plan, Auto, Bypass, Don't ask (menu lists six; Plan blocks writes; Manual prompts; Allow/Deny work).
- ✅ Permission rules `Tool(spec)` in settings (allow/ask/deny); pop-up has Allow once / Always allow / Deny.
- ✅ Project memory (AGENTS.md / CAELIX.md / rules / notes) loaded; `/remember` saves notes (memory load checked).
- ✅ Sessions saved, listed, reopened after restart with messages and tool cards.
- 🟡 Rename, pin, fork, archive, delete: built; only rename-by-first-message and restart persistence checked.
- ✅ Checkpoints and rewind restore files. 🟡 Rewind of conversation only built.
- ✅ `/compact` summarises. 🟡 Automatic compaction at 80% not triggered in a check.
- ✅ CLI print mode `bin/caelix.js` (text/json/stream-json) tested with the pretend AI.

## Code view (look and flow)
- ✅ Layout measured against the real Code view: sidebar border 286–287 pt (real 286–288), rail border 1092 pt (real 1092), title bar border 43–44 pt (real ~44).
- 🟡 "At least 90% the same": layout positions, panels and flow match; an automatic pixel score is not meaningful (different content), and only one real capture exists, so 90% is **not proven**. Fonts, icon glyphs and spacing are approximations.
- ✅ Sidebar, title bar with pane icons, transcript with collapsed tool groups, task card, composer with model/effort/mode row, session rail (Environment, Context, Changes, Connectors, Outputs, Background tasks).
- ✅ Changes pane (diff with counts), Terminal pane (runs in session folder), Files pane, Browser pane (URL bar).
- 🟡 Diff line comments, file editor auto-save, side chat, view modes, slash menu items other than `/` and `/compact`: built, not individually checked.
- ❌ Split view, pop-out panes, drag-to-arrange panes, minimize pane, iOS simulator, computer use, voice input (mic button is disabled), prompt suggestions, image/PDF attachments.
- 🟡 Terminal is a plain shell without a pty (no full-screen programs).
- ✅ Dark theme renders (screenshots 11 and 12).

## Speed
- ✅ Window opens in under 2 s (measured 0.5–1.0 s warm).
- ✅ Panes and modals load only when first opened.
