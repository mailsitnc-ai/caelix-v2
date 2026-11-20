# AGENTS.md — rules for every session on CAELIX

CAELIX (v2) is our own desktop coding-agent app. See `features.md` for what it must do and `SPEC.md` for the study and build plan.

1. **Do everything yourself. Never ask the user anything.** Announce each step in one line first. (The only exception: if a step needs the user's password, stop and tell them.)
2. **Never say something is saved or working unless a check shows it.** Show the check.
3. **Write your own code.** Never copy code or built-in instructions (prompts) from Claude Code or the Claude app. Study behaviour, then write it fresh.
4. **Stack:** Electron with plain HTML, CSS and JavaScript. No React, no build tools, no packages that need compiling.
5. **Keep it fast:** tools that don't depend on each other run at the same time; nothing loads until it's needed.
6. **Never run anything that keeps running in the foreground.** Start our app and servers in the background.
7. **Keys** are saved encrypted on this computer, outside this folder, and never shown in full (show only the last 4 characters).
8. **Self-check:** the app has a self-check mode in which a pretend AI that needs no key drives the real app end to end, then closes. It saves a screenshot, every error, the start time and the memory use in `checks/`. Run it after every change and fix every error before moving on.
9. **Save a version (git commit) each time a feature works.**

## Identity

- The application is named **CAELIX** everywhere: window title, app metadata, package configuration and interface.
- The official icon is the supplied star image: `assets/source/caelix-icon-original.webp`. Do not replace, redraw or regenerate it. All sizes are produced from it by `scripts/make-icons.py` into `assets/icons/`.
- No Claude or Anthropic branding, names or logos, except where needed to identify a supported provider or explain compatibility.

## Folders

- `assets/` icons and images (committed)
- `scripts/` helper scripts (committed)
- `study/` research material and screenshots (git-ignored)
- `checks/` self-check output (git-ignored)

## Tooling notes for this computer

- Use Homebrew Node (`/opt/homebrew/bin`, 26.x). The `node` earlier on PATH (`STUDENT-VOICE-BUILDER/.tools`) is too old for REA; put `/opt/homebrew/bin` first.
- REA is registered for OpenCode. Its registration points into the npx cache, so run its doctor with the same launcher, or install it globally with `npm install --global rea-agents`.
