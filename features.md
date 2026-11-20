# CAELIX — Features

CAELIX is our own desktop coding-agent app, version **v2**. It is built from scratch, for learning, after studying how a terminal coding agent and its desktop "Code" view behave. No code, prompts or branding are copied from any other product.

## 1. The complete agent harness (everything the engine does, working the same way)

- The agent loop: send the conversation to a model, stream the reply, run the tools the model asks for, feed results back, repeat until done.
- Built-in tools: read files, write files, exact-string edit, multi-edit, list/glob, content search (grep), shell commands (foreground and background, with timeouts), web fetch, web search, notebook edit, task list, sub-agents, plan mode entry/exit, ask-the-user.
- Parallel tool calls: tools that do not depend on each other run at the same time.
- Permission system: allow / ask / deny rules per tool and per pattern; modes (ask each time, auto-accept edits, plan, bypass).
- Project memory: a project instructions file read at session start, plus saved notes.
- Saved sessions: every chat is stored, listed, renamed, resumed, forked.
- Context management: running token count, automatic summarising when the window fills.
- Slash commands and skills: built-in commands plus user-defined ones from folders.
- Hooks: scripts that run before/after tool calls.
- MCP: connect external tool servers.
- Non-interactive command-line mode (print mode) with text and streaming-JSON output.
- Checkpoints: see and undo the file changes of a turn.

## 2. The Code view of a desktop coding-agent app, around the engine

- Sidebar with projects and chats (grouped, searchable, rename, archive, pin).
- Folder picker to start a session in any folder.
- Chat pane: streamed text, tool-call cards, collapsible results, thinking blocks, markdown and code rendering.
- Composer: multi-line input, model picker, mode switcher, attach files, slash menu, send/stop.
- Permission pop-up with allow once / always / deny.
- Changes panel (diff of every edited file) and Terminal panel (live shell).
- Task list under the latest message, plan view, status line with context use.
- Settings and a Keys screen.

## 3. It looks at least 90% like that Code view

Same layout, panels, sizes and flow. Verified by side-by-side screenshot comparison, with the largest differences fixed until the match is at least 90%.

## 4. Models and keys

- Runs on the user's own **Gemini**, **OpenRouter** and **NVIDIA** keys, pasted on a Keys screen, with any model each of them offers (model list fetched live, searchable).
- Keys are stored encrypted on this computer, outside the project folder, and never shown in full.
- Can also run the **real Claude Code** as an alternative engine (when installed and signed in), driven through its streaming mode.

## 5. Speed

- The window opens in under 2 seconds.
- Reply words appear the moment they arrive (token streaming, no batching).
- Nothing loads until it is needed (lazy panels, lazy model lists); independent work runs in parallel.

## 6. Identity

- Name: **CAELIX** (window title, menus, app metadata, package config, interface, installed app, desktop shortcut).
- Icon: the supplied CAELIX star icon, used as-is (`assets/source/caelix-icon-original.webp`); sizes and `.icns` generated from it by `scripts/make-icons.py`. No generated or substitute icon.
- No Claude or Anthropic names or logos in the product, except where needed to name a supported provider or explain compatibility (for example the "real Claude Code" engine option).

## Technology

Electron with plain HTML, CSS and JavaScript. No React, no build tools, no packages that need compiling.
