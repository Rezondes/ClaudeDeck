# ClaudeDeck

A Stream Deck plugin for Claude Code. Approve permission prompts with a key press, watch the live state of every session and keep an eye on your Claude plan limits without switching windows.

Works with the Code tab of **Claude Desktop** and with the **Claude Code CLI**.

> Unofficial community project, not affiliated with Anthropic or Elgato.

## Features

| Key | What it shows | What a press does |
|-----|---------------|-------------------|
| **Claude Status** | Project or session title, state (color and text) and a bar for context window usage in percent | Short press: opens the session in Claude Desktop (for CLI sessions it brings the terminal window forward). Long press (0.6 s or more): aborts the running turn of exactly this session |
| **Allow** | The oldest pending permission request with its tool and command | Approves this request once |
| **Always Allow** | Same as Allow | Approves the request and stops asking for this kind of request for the rest of the session |
| **Deny** | Same as Allow | Rejects the request |
| **Plan Usage** | Usage of the 5 hour and 7 day limits, `LIMIT` when a limit is hit | Shows for 3 s when the limits reset |
| **Claude Window** | The next action (maximize or minimize) | Maximizes Claude Desktop and brings it forward, or minimizes it when it is already maximized |
| **Claude Project** | A folder shared with Claude Code projects, its open project threads on this PC and their most urgent state | Opens the project in Claude Desktop at its most urgent thread. Needs the project link (or `chan_...` id) pasted in the key settings, because Desktop does not store it locally; without it, opens the most urgent thread on its own, or brings Claude Desktop forward when there is none |
| **Claude Reload** | Nothing changing | Short press: rereads Desktop sessions, projects and context and redraws all keys (check mark, or an alert when a part failed). Long press (0.6 s or more): restarts the plugin |

### Status key states

| Color | Text | Meaning |
|-------|------|---------|
| Blue | Working | Claude is working (also while background agents are running) |
| Yellow, flashing | Approve | Claude is waiting for a permission decision |
| Purple, flashing | Input | Claude asked a question and is waiting for your answer |
| Green | Done | The turn is finished. Stays until the next prompt or a key press, at most 10 minutes |
| Red | Error / Limit | The turn failed with an API error, `Limit` when a usage limit was hit |
| Gray | Idle | The session is open but nothing is happening |

The context bar turns yellow at 50 % and red at 80 %.

### Good to know

- **Several sessions:** Status keys fill up in the order sessions become active. When more sessions are waiting than there are keys, an empty status key shows `N waiting`. Pressing it opens "Sessions Waiting for You" in Claude Desktop.
- **Desktop sessions show up right away:** Claude Desktop sessions that were active in the last 12 hours appear on startup, not only after their first prompt.
- **Several pending requests:** Allow, Always and Deny always act on the oldest one. With more than one pending, the key also shows which session it belongs to.
- **Questions from Claude** cannot be answered with Allow or Deny. Only the status key flashes purple; pressing it takes you to the question.
- **Timeout:** If a request is not decided on the Stream Deck within 60 s, the normal prompt appears in Claude.
- **Stream Deck not running?** Claude Code simply asks as usual. Nothing gets lost.

## Requirements

- Windows 10 or 11
- Stream Deck software 7.1 or later (developed on a Stream Deck MK.2)
- Claude Desktop (Code tab) and/or Claude Code CLI
- Node.js 24 and npm to build the plugin

## Installation

ClaudeDeck has two parts: the **Stream Deck plugin** and a small **Claude Code plugin** that sends events from Claude Code to the Stream Deck.

### 1. Build and link the Stream Deck plugin

```powershell
git clone https://github.com/Rezondes/ClaudeDeck.git
cd ClaudeDeck
npm install
npm run build
npm run link
```

The **ClaudeDeck** category now appears in the Stream Deck app. Drag the keys you want onto your Stream Deck.

### 2. Install the Claude Code plugin

In Claude Desktop (Code tab) or in the CLI:

```
/plugin marketplace add Rezondes/ClaudeDeck
/plugin install claudedeck@claudedeck
```

New sessions now send their events to the Stream Deck. Restart sessions that are already running.

### 3. Optional: ClaudeDeck module for exact values

Without the module, ClaudeDeck estimates the context from the transcript. With the module you also get:

- the exact context value (including 1M context windows),
- the **Plan Usage** key with the 5h and 7d limits,
- aborting a running turn with a long press on its status key.

```powershell
npm run module:install
```

This adds exactly two variables to the `env` block of `~/.claude/settings.json`: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` and the path of `claude-module/` in `CLAUDE_CODE_PLUGIN_DIRS`. All other entries stay untouched, and no values from the file are printed. Only new sessions load the module.

> Note: Plugin modules are an early access feature of Claude Code. The switch applies to every plugin with modules, and the API may change. ClaudeDeck also works without the module.

To remove it:

```powershell
npm run module:remove
```

## Setting up a status key

In the property inspector of a **Claude Status** key:

- Leave **Project folder** empty: the key shows sessions in the order they start.
- Set **Project folder** (e.g. `F:\Code\MyProject`): the key always shows a session of this folder. Several keys with the same folder show its sessions, newest first.
- **Latest session only:** the key always shows the folder's most recently active session.

## Updating

```powershell
git pull
npm install
npm run build
npm run reload
npm run plugin:update
```

`npm run reload` restarts the plugin process (Stream Deck starts it again after about 10 s), `npm run plugin:update` fetches the latest version of the Claude Code plugin.

## Uninstalling

1. `npm run module:remove` (if the module was installed)
2. In Claude Code: `/plugin uninstall claudedeck@claudedeck` and `/plugin marketplace remove claudedeck`
3. Remove the plugin in the Stream Deck app

## Known limitations

- Windows only.
- Projects in Claude Desktop are not shown as sessions yet, only regular sessions.
- For CLI sessions the status key only brings the terminal's main window forward, not a specific tab.

## How it works

```
Claude Code (Desktop / CLI)
  ├─ Claude Code plugin "claudedeck"   claude-plugin/   HTTP hooks, no logic of its own
  └─ ClaudeDeck module (optional)      claude-module/   exact context, limits, abort
            │  POST http://127.0.0.1:37419/...
            ▼
Stream Deck plugin "ClaudeDeck"        src/, com.claudedeck.streamdeck.sdPlugin/
  Hook server ─ session store ─ pending approvals ─ keys
```

- All logic lives in the Stream Deck plugin. The Claude Code plugin is hook configuration only.
- The hook server listens on `127.0.0.1:37419` only, accepts only `Content-Type: application/json` and rejects requests with an `Origin` header, so web pages cannot talk to it.
- If the port is taken, Allow, Always and Deny show `offline`.
- ClaudeDeck reads titles and folders of Desktop sessions from `%APPDATA%\Claude\claude-code-sessions` and, for the Microsoft Store version, from `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`.

## Development

```powershell
npm install
npm test              # unit tests (Vitest)
npm run build         # builds com.claudedeck.streamdeck.sdPlugin/bin/plugin.js
npm run watch         # rebuilds on change and reloads the plugin
npm run test:module   # checks the Claude Code module with "claude plugin test"
```

| Folder | Contents |
|--------|----------|
| `src/server/` | HTTP server for hooks and the module, queue of pending approvals |
| `src/domain/` | Session state and context calculation |
| `src/actions/` | Logic of the Stream Deck keys |
| `src/render/` | SVG rendering of the keys |
| `src/desktop/` | Reads the Claude Desktop session catalog |
| `src/win/` | Finds, focuses, minimizes and maximizes windows (PowerShell) |
| `src/installer/` | `module:install` and `module:remove` |
| `claude-plugin/` | Claude Code plugin with the hooks |
| `claude-module/` | Claude Code plugin module |
| `com.claudedeck.streamdeck.sdPlugin/` | Manifest, icons, property inspector |
| `PLAN.md`, `docs/spike-results.md` | Work packages and spike results (German) |

The plugin log is in `com.claudedeck.streamdeck.sdPlugin/logs/`.
