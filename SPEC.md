# CAELIX SPEC (study of the agent harness and its desktop Code view)

Written in our own words. Marks: **[seen]** observed first-hand (official docs, `claude --help`, the `init` event of a real run, a window capture of the Code view, REA output); **[guess]** inferred, not confirmed; **[unknown]** not yet found.

## Study status and honest gaps

- Sources used: official docs (saved in `study/docs/`), `claude --help` (`study/docs/cli-help.txt`), the `system/init` event from three print-mode runs (`study/runs/`), a sidebar-free capture of the Code view (`study/screens/code-view-main-no-sidebar.png`), REA analysis of a copy of the desktop app's `app.asar` (`study/desktop-app/`).
- **Print-mode model runs were blocked**: the standalone `claude` CLI is not signed in on this computer, so all three runs ended at "Not logged in". Real tool-call/stream event shapes beyond the docs are therefore **[unknown]** until the user signs in (a password step I must not do) or the harness is studied through REA only.
- **Screenshots**: only one capture exists (this session's chat area plus right rail). The sidebar was cropped away on purpose so no other chats are stored. The new-session screen, permission pop-up, diff pane, terminal pane and settings were **not** captured. They are described from docs only.
- REA's analysis of the desktop app needed `SDKROOT=…/MacOSX26.5.sdk` (the default SDK 27.0 is newer than the installed Swift 6.3.3). The run on `app.asar` is slow (1,093 files incl. large vendor bundles); results are added under `study/desktop-app/` when it finishes. Until then, internals of the renderer are **[unknown]**.
- The Claude app was never modified: only a copy of `app.asar` is in `study/`.

## A. Layout of the Code view (measured, **[seen]** from the capture, window 1408×881 pt)

| Region | What I see |
|---|---|
| Left sidebar | 0–287 pt wide, separated by a 1 pt line; lists sessions (content not captured). Docs: "+ New", group/sort icon, rename via title, archive, split view. |
| Title bar | ~44 pt high. Session title with a caret (opens the session menu: transcript view, rename…). Right side, icon buttons in this order: session rail (list icon, highlighted when on), terminal, diff (±), browser (globe), files (folder), ⋮ menu. |
| Chat column | From the sidebar to ~1088 pt (about 800 pt wide), text column ~680 pt wide, left padding ~48 pt. Light background, 1 pt border on the right. |
| Transcript | Plain assistant text; each group of tool calls collapses into one grey line ("Ran 2 commands ›", or a short description, ›). A running step shows an orange spinner dots icon, a description and an elapsed time. The task list sits in a rounded card (check-circle done, spinner current, dashed circle pending). |
| Composer | Rounded 14–16 pt pill at the bottom. `+` button left, placeholder "↵ to send, ⌘↵ to queue for later", stop (black square) while running, microphone right. Under it, a small row: model name ("Sonnet 5.5"), effort ("Medium"), permission mode ("Auto"), a context-ring on the far right. |
| Right session rail | ~316 pt (1092–1408 pt). Cards: **Environment** (This computer + Save, folder name and path, git branch, Remote Control toggle), **Context** with % and a thin bar, **Connectors** with status, **Outputs** (files made), **Background tasks** (running + "N finished"). |
| Colours/type | White chat surface, near-black text, grey secondary text, accent orange for the working spinner, system sans-serif ~15 pt body. |

## B. Complete numbered feature list

Format: **#. Name** — *what the user sees* / *what happens behind it* / **E2E test**. Mark in brackets.

### B1. Engine tools (names are the exact permission-rule names) 

1. **Read** [seen] — file contents shown as a collapsed step / reads a path (lines, offset, images, PDFs, notebooks), large files get a partial-view notice / **Test:** ask for line 2 of a 3-line file; answer must be "beta".
2. **Write** [seen] — "Wrote file" step and a diff in Changes / create or overwrite; must have been read first if it exists / **Test:** create `hello.txt`; file exists with exact text.
3. **Edit** [seen] — diff card / exact single-match string replace, `replace_all` option, must be read first, refuses non-UTF-8 / **Test:** change "beta" to "BETA"; a non-unique match must fail with a clear error.
4. **NotebookEdit** [seen] — cell change / edits a `.ipynb` cell / **Test:** replace cell 0 source.
5. **Glob** [seen] — step "Found N files" / pattern match sorted by recency / **Test:** `**/*.txt` lists `notes.txt`.
6. **Grep** [seen] — step with matches / regex content search with context options / **Test:** find "gamma".
7. **Bash** [seen] — command card with output / separate process per command, cwd carries over inside project, env does not; default 2 min timeout, max 10 min; output cap ~30k chars inline, bigger saved to a file with a preview; slow commands move to background; read-only commands skip prompts / **Test:** `echo hi && pwd`; a `sleep 130` auto-backgrounds.
8. **Monitor** [seen] — background task row / streams each output line of a background command back to the model / **Test:** watch a loop printing 3 lines; 3 events arrive.
9. **TaskStop** [seen] — stops a background task by id / **Test:** start and stop a `sleep 600`.
10. **WebFetch** [seen] — fetch step / fetch URL, convert to text, per-domain permission / **Test:** fetch a local test page.
11. **WebSearch** [seen] — search step / needs a search backend (CAELIX: choose later) / **Test:** query returns titles+URLs.
12. **Agent (a.k.a. Task)** [seen] — sub-agent card / runs a child loop with its own context and its own tool list, returns a final report; types Explore, Plan, general-purpose, custom / **Test:** ask for a sub-agent to count files; result returns to parent.
13. **SendMessage / ListAgents** [seen] — message other agents or sessions / **Test:** resume a finished sub-agent by id.
14. **TodoWrite / TaskCreate, TaskGet, TaskList, TaskUpdate** [seen] — the task-list card above the composer / a checklist with statuses and dependencies / **Test:** 3 tasks progress pending → in progress → done.
15. **EnterPlanMode / ExitPlanMode** [seen] — plan card with Approve / enters read-only planning; exit asks permission / **Test:** in plan mode no file changes; approving leaves plan mode.
16. **AskUserQuestion** [seen] — multiple-choice card / blocks until answered / **Test:** question with 2 options; chosen label returns.
17. **Skill** [seen] — step "Skill" / loads a skill's instructions into the turn / **Test:** a folder skill runs from `/name`.
18. **EnterWorktree / ExitWorktree** [seen] — session in an isolated git worktree / **Test:** create, edit, exit; main tree unchanged.
19. **CronCreate / CronList / CronDelete, ScheduleWakeup** [seen] — scheduled prompt in the session / **Test:** one-shot in 1 minute fires.
20. **ToolSearch** [seen] — loads deferred tool schemas by name/keyword / **Test:** `select:Name` returns the schema.
21. **LSP** [seen, docs] — code intelligence via language servers / **Test:** find definition. (Later phase.)
22. **MCP tools / ListMcpResources / ReadMcpResource** [seen] — external tools named `mcp__server__tool` / **Test:** connect a stub server; call its tool.
23. **PushNotification, SendUserFile, ReportFindings, Artifact\*, DesignSync, Workflow, EndConversation, plugin/skill listing tools** [seen names, behaviour in docs] — niche; implement the ones that make sense offline (notifications, send-file, findings list) and mark the claude.ai-only ones as not applicable.

### B2. Engine behaviours

24. **Agent loop and streaming** [seen] — words appear as they arrive / call model, stream text deltas, collect tool calls, run them (independent ones in parallel), return results, repeat; stop on end turn or Esc / **Test:** pretend model emits 3 chunks; UI shows each before the next.
25. **Permission modes** [seen] — mode picker with Manual, Accept edits, Plan, Auto, Bypass (+ `dontAsk` CLI-only) / rule engine: deny > ask > allow, then mode default / **Test:** each mode vs write, bash, read.
26. **Permission rules** [seen] — `Tool`, `Tool(specifier)`, wildcards, `Tool(param:value)`, domain rules, MCP names / **Test:** allow `Bash(npm run *)`, deny `Read(./.env)`.
27. **Permission pop-up** [seen docs; look unknown] — allow once / always / deny with optional comment / **Test:** deny sends a refusal to the model, which adapts.
28. **Project memory** [seen] — instructions file(s) loaded at start (project, user, subfolder, rules folder, imports), plus auto memory notes / **Test:** an instruction in the file changes the reply.
29. **Sessions saved** [seen] — sidebar list, rename, resume, fork, archive / JSONL transcript per session at `~/.claude/projects/<path-with-dashes>/<id>.jsonl` in the original; CAELIX uses its own folder / **Test:** restart; session reappears with its messages.
30. **Context + compaction** [seen] — Context card % / token count, auto-summarise when full, `/compact` / **Test:** low threshold triggers a summary and continues.
31. **Checkpoints / rewind** [seen] — snapshot before each prompt, restore code, conversation or both, last 100 / **Test:** edit, rewind, file restored.
32. **Slash commands** [seen] — ~100 names (`/clear /compact /model /permissions /resume /rewind /diff /init /memory /mcp /hooks /plan /rename /export /cost /context …`) / **Test:** `/clear` empties the chat; `/model` switches.
33. **Hooks** [seen] — 30+ events (SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, Stop, PreCompact, SessionEnd …) run user commands that can block / **Test:** PreToolUse hook blocks `Bash`.
34. **Settings layers** [seen] — user, project, local, managed; precedence / **Test:** local overrides project.
35. **Print mode / CLI** [seen] — `-p`, `--output-format text|json|stream-json`, `--include-partial-messages`, `--resume`, `--model`, `--permission-mode`, `--allowedTools`, `--max-turns`, `--max-budget-usd` / **Test:** `caelix -p "hi"` prints a reply; JSON mode ends with a result object.
36. **Stream events** [seen docs; real shapes unknown] — `system/init` (tools, model, permissionMode, session_id, memory paths, version), `system/status`, `assistant`, `stream_event` text deltas, `result` (cost, usage, `permission_denials`) / **Test:** parse a full run.
37. **Output styles, effort levels, fast mode, model aliases** [seen] / **Test:** effort changes request parameter.
38. **Sandbox, worktree option, background sessions, remote control, cloud, SSH** [seen names] — later / out of scope for v1 except worktree.

### B3. Code view (desktop)

39. **Sidebar** [seen layout] — sessions grouped, + New (⌘N), search, archive, pin, drag to split / **Test:** create 2 sessions, switch with ⌃Tab.
40. **New-session screen** [guess look; docs behaviour] — prompt box with a row: environment, project folder, permission mode, model / **Test:** choose a folder, mode, model, send.
41. **Folder picker** [guess] / **Test:** pick folder; Environment card shows name and path.
42. **Chat transcript** [seen] — collapsed tool summaries, streaming text, markdown, code blocks, file paths clickable / **Test:** reply with markdown renders.
43. **View modes** [seen docs] — Normal / Thinking / Verbose, ⌃O cycles / **Test:** verbose shows every tool call.
44. **Composer** [seen] — `+` (attach files, skills, connectors, plugins, add folder), @file mention, slash menu, queue with ⌘↵, stop, suggested next prompt (Tab accepts), mic / **Test:** @file adds it; ⌘↵ queues.
45. **Model / effort / mode pickers** [seen] — ⌘⇧I, ⌘⇧E, ⌘⇧M / **Test:** shortcuts open menus.
46. **Task-list card** [seen] / **Test:** appears with steps.
47. **Session rail** [seen] — Environment, Context, Connectors, Outputs, Background tasks / **Test:** values update live.
48. **Changes (diff) pane** [seen docs] — file list, +/- counts, per-line comments (+ on hover), ⌘↵ submits comments / **Test:** edit a file; diff shows; comment sent to model.
49. **Terminal pane** [seen docs] — ⌃` toggles, opens in the session folder, extra tabs / **Test:** `pwd` in pane equals folder.
50. **Files pane** [seen docs] — view/edit, auto-save toggle, right-click menu (attach, open in, Finder, copy path) / **Test:** edit saves to disk.
51. **Browser pane / preview** [seen docs] — ⌘⇧B / **Test:** load a local page. (Phase 3.)
52. **Pane layout** [seen docs] — drag, resize, minimize, pop out, ⌘\ closes focused pane / **Test:** reorder panes.
53. **Side chat** [seen docs] — ⌘; or `/btw`, not saved / **Test:** question answered, main chat unchanged.
54. **Split view / new window** [seen docs] / **Test:** open two sessions side by side.
55. **Notifications** [seen docs] — OS notice when a background session finishes / **Test:** fires when unfocused.
56. **Settings** [seen docs] — Code settings (prompt suggestions, auto-archive, branch prefix, worktree location, bypass toggle) / **Test:** toggles persist.
57. **Keys screen (CAELIX only)** — Gemini, OpenRouter, NVIDIA; paste key, shown as `••••1234`; encrypted store outside project via Electron `safeStorage` / **Test:** save, restart, last 4 shown, file on disk has no plaintext.
58. **Model list per provider (CAELIX only)** — fetched live, searchable / **Test:** OpenRouter list returns >100 models (with key).
59. **Real Claude Code engine option (CAELIX only)** — spawns installed `claude` in stream-json mode and maps events to the same UI / **Test:** requires sign-in; with pretend binary, events render.
60. **Self-check mode (CAELIX only)** — pretend AI, scripted end-to-end run, screenshot, errors, start time, memory → `checks/` / **Test:** exits 0 with files written.
61. **Identity** — name CAELIX, supplied icon in window, Dock, bundle, desktop shortcut / **Test:** `plutil` shows CFBundleName CAELIX; `.icns` is the supplied art.

## C. Wire format needed by the pretend AI (from docs, [guess] where marked)

Model adapters normalise every provider to: `text_delta`, `tool_call{id,name,input}`, `end_turn|tool_use|max_tokens`, `usage{in,out}`. Gemini, OpenRouter (OpenAI-style streaming) and NVIDIA (OpenAI-compatible) endpoints are each [guess] until tested with a key.

## D. Build plan

### Part 1 — Engine, CLI, basic window (commit after each working item)
1. Project skeleton: `package.json` (name CAELIX), `main.js`, `preload.js`, `renderer/` (plain HTML/CSS/JS), icon wired into `BrowserWindow`.
2. `engine/`: model adapter interface, scripted pretend adapter, agent loop with parallel tool execution, streaming events.
3. Tools 1–10 and 14–16 first; then 11–13, 17–23.
4. CLI `bin/caelix.js` with print mode, text/json/stream-json.
5. Keys store (`safeStorage`, file in `~/Library/Application Support/CAELIX/`), Keys screen, Gemini/OpenRouter/NVIDIA adapters, model picker with live search.
6. Basic window: composer, streamed transcript, tool cards, sidebar stub.
7. Self-check mode (pretend AI → screenshot, errors, startup ms, memory) running green.

### Part 2 — Permissions, modes, persistence, panels
1. Rule engine and mode picker; permission pop-up.
2. Sessions saved/resumed/renamed/forked; sidebar list; restart test.
3. Project memory (instruction file + notes), settings layers.
4. Changes pane (diff) and Terminal pane (pty-free shell first; no compiled packages), checkpoints and rewind.
5. Context meter and compaction.

### Part 3 — Everything else
1. Hooks, slash commands, MCP, skills, sub-agents, worktrees, scheduling, side chat, split view, notifications, files and browser panes, view modes, keyboard shortcuts.
2. Real Claude Code engine option.
3. Package as `CAELIX.app` with the supplied icon (`.icns` from `assets/icons`), install to `/Applications`, desktop shortcut (alias) on `~/Desktop`.
4. Visual match: capture our app and the real Code view with the same window size via REA (`capture-native-ui-scenario` / `compare-web-screenshots`), list differences by area (sidebar, title bar, rail, composer, spacing, colours), fix largest first until ≥ 90% match. Capture only the non-sidebar region of the real app.
5. Test every feature (list B) end to end; write `CHECKLIST.md` with ✅/❌ per item; fix every ❌.

## E. Open items for the next session
- Finish the REA run on `app.asar` and add findings (window sizes, CSS tokens, IPC channel names, how it spawns the engine) to a section F.
- Capture real screens (new-session, permission pop-up, diff, terminal, settings) once a signed-in run is possible without exposing other chats.
- Sign-in of the standalone `claude` CLI is needed for any real print-mode run; this requires the user.

## F. REA findings on the desktop app (added after the analysis finished)

- **[seen]** `analyze-javascript-application` on a copy of `app.asar` (v6.28899.2) examined all 1,519 files: a Vite-built Electron app whose main process is split into bundles under `.vite/build/` with separate worker bundles (`file-index-worker`, `frame-local-worker`, `heavy-work-worker`), a find-in-page module, and bundled libraries (for example a diagram library under `resources/artifact-libs/`).
- **[seen]** Large bundles exceeded REA's per-file semantic budget; module and static facts were kept. Saved evidence: `study/desktop-app/app-evidence.json` (git-ignored).
- **[guess]** The Code tab renderer is remote content hosted by claude.ai rather than bundled UI, since the bundle has no Code-view CSS or layout files of its own. That is why layout was measured from a window capture instead.
- **[seen]** Lesson for CAELIX: keep the main process small and push file indexing and heavy work into workers; CAELIX defers pane and modal code until first use for the same reason.
