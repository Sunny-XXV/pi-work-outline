# pi-work-outline

A Pi extension that asks the agent to maintain a compact, live work tree while it works. In a tmux session the outline opens in a side pane; elsewhere it uses a Pi widget. Headless sessions still maintain the Markdown observer file.

The outline is designed as operational context rather than a disposable todo list. When the user substantially redirects a task, the agent is instructed to compress the prior route in place, retain useful completed work, record the transition, and continue in the same tree.

## Features

- Toggle at runtime with `/work-outline` and restore the saved state on later session loads.
- Renders a small Markdown subset as a status-colored tree.
- Opens a dedicated tmux pane when possible and safely falls back to a bounded Pi widget.
- Provides `/work-outline view` for a focusable, scrollable view of the full current outline.
- Persists enabled state and the selected file on the active session branch.
- Restores outline contents along with the selected Pi tree branch.
- Forks and clones inherit the selected branch's snapshot into a session-owned default file.
- Uses Pi's configured agent directory for per-session state.
- Preserves prior work across major goal changes instead of resetting the outline.
- Runs without external runtime dependencies beyond Pi and Node.js.

## Install from GitHub

Install from the main branch:

```bash
pi install git:https://github.com/Sunny-XXV/pi-work-outline
```

Or pin the v0.2.0 release:

```bash
pi install git:https://github.com/Sunny-XXV/pi-work-outline@v0.2.0
```

For local development or a one-off run:

```bash
pi -e ./path/to/work-outline
```

Then run `/work-outline on` in Pi. Pi provides `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`; do not install private copies into this repository.

## Usage

Enable the outline in the current session with `/work-outline on`. The saved branch state restores it on later session loads.

For a custom observer file, set `WORK_OUTLINE_FILE` before starting Pi; relative paths resolve from Pi's working directory. The path precedence is:

1. `WORK_OUTLINE_FILE`
2. restored session path
3. `<agent-dir>/state/work-outlines/<session-id>.md`

Runtime commands:

```text
/work-outline          enable or show status
/work-outline on       enable
/work-outline off      disable
/work-outline status   show status
/work-outline view     open the bounded scrollable viewer
```

## Settings

Configure the preferred renderer and tmux pane width in the agent-directory `settings.json`. A trusted project may override individual fields in `.pi/settings.json`:

```json
{
  "work-outline": {
    "defaultRenderer": "tmux",
    "tmuxSplitPercent": 34
  }
}
```

`defaultRenderer` accepts `tmux`, `auto`, or `widget`. `tmux` is the compatibility-preserving default. `tmux` and `auto` attempt tmux first and fall back to the native widget; `widget` skips tmux. The standalone tmux renderer automatically reuses a Node host or discovers `node` through `PATH`; if no valid Node.js runtime is available, the extension warns once and uses the native widget. `tmuxSplitPercent` accepts an integer from 10 through 80. Invalid values use the defaults shown above. The earlier draft names `renderer` and `tmuxPanePercent` are also accepted for compatibility. Run `/reload` after editing settings.

The widget displays at most eight rows and links to `/work-outline view`; the viewer shows the full current outline with arrow, Page Up/Down, Home, and End scrolling. Escape or `q` closes it. A tmux refresh clears stale pane history before drawing the full current document, so scrollback does not accumulate older versions. `/work-outline status` only reports the current state. Running `/work-outline`, `/work-outline on`, or `/work-outline enable` performs at most one repair attempt when a remembered tmux pane has disappeared; there is no background pane-restart loop.

## Tree history and forks

Pi's `/tree` changes conversation history; it does not undo filesystem changes. This extension uses Pi's own `appendEntry()` / `getBranch()` state mechanism to save the outline's Markdown as `work-outline-snapshot` entries. Those entries are not added to model context. The external `.md` file is the live working copy for the agent and both renderers.

Changed contents are captured before completed assistant/tool-result messages are persisted, at the final actionable run boundary, and before leaving or disabling a session. Identical snapshots are not appended again. Selecting an assistant response in `/tree` therefore includes the outline snapshot available at that response; selecting a user message follows Pi's normal behavior and returns to **before** that input. Restoration reads only snapshots on the selected branch and writes the nearest matching snapshot back to the working file. Compaction retains the underlying session entries, so outline history is not lost.

Outline restoration follows the branch Pi actually selects, including after reopening a session. In Pi 1.1.0, tree navigation without appending an entry only moves the in-memory leaf; reopening uses the last persisted entry, which may be on another branch. The outline follows that reopened branch rather than independently preserving the last navigation target. Continuing the conversation on the selected branch persists that branch through new entries.

`/fork`, `/clone`, and CLI `--fork` already copy the selected Pi branch's entries. Generated outline files use this inherited snapshot to initialize `<agent-dir>/state/work-outlines/<new-session-id>.md`; subsequent parent/child updates no longer share a file. No parent-session JSONL parsing or separate snapshot database is needed.

`WORK_OUTLINE_FILE` and other custom paths are intentionally not relocated, but their contents still restore with the session branch. Two sessions pointing at the same custom file can overwrite each other's working copy; use separate paths for concurrent work.

Existing sessions have no historical snapshots to recover. On first load, the current working copy becomes a baseline **at the current leaf only**. Navigating/forking to an older point without a snapshot starts a fresh seed rather than importing future branch contents. An outline that was disabled at the selected point stays disabled, while its saved contents are still restored. Uncheckpointed edits made while Pi is not running may be replaced by the saved snapshot on resume; files and session history are not a general-purpose filesystem backup.

## Observer format

The agent writes only two headings and `- ` list items, with two spaces per nesting level:

```markdown
# GOAL

- Deliver a reviewed implementation.

# WORK

- DONE Inspect the current implementation
  - Found one reusable parser and two duplicated render paths.
- WORK Refactor the renderer
  - TODO Run regression tests
```

Supported status labels are the uniform four-letter set `TODO`, `WORK`, `WAIT`, `BLKD`, `HUMN`, `DONE`, `HOLD`, and `DROP`. Use `HUMN` when progress requires a person's answer, approval, authentication, decision, or action; reserve `BLKD` for unavailable non-human dependencies. Existing outline files using `RUN`, `BLOCK`, or `HUMAN` remain readable and are rendered as their canonical `WORK`, `BLKD`, or `HUMN` aliases.

Both renderers display status labels as high-contrast background badges. Every badge covers one terminal cell before and after its four-letter label, followed by one unstyled body gap. `WORK`, `WAIT`, `BLKD`, `HUMN`, and `HOLD` request terminal-native blink, while passive/completed badges remain static. Terminals that disable blink still show the background colors, and the extension performs no animation polling or periodic redraw. Child guides join the parent badge at its left edge; a tagged parent that wraps carries its child stem through every continuation line.

## Design

```text
index.ts                Pi lifecycle, commands, and prompt section
prompt.md               Agent-facing continuity and outline policy
bin/tmux-renderer.mjs   Standalone tmux process and terminal colors
src/config.ts           Pure path/state-precedence logic
src/history.ts          Pi-branch snapshots and atomic working-file restoration
src/outline.mjs         Shared parser, tree layout, sanitation, wrapping
src/outline.ts          Typed Pi-extension facade over the shared module
src/settings.ts         Namespaced user/project settings adapter
src/state.ts            Pi branch-state and configured-directory adapter
src/tmux.ts             tmux lifecycle, render mode, and pane ownership
src/view.ts             Pure native-view height policy
src/widget.ts           Passive widget and interactive Pi viewer
test/                   Node built-in test suite
```

The standalone renderer and Pi widget share parser, sanitation, width, and tree-layout semantics; terminal-specific styling and wrapping adapters remain separate.

## Development

Requires Node.js 22.19 or newer, matching Pi 1.1.0's runtime floor.

```bash
npm test
npm run check
```

No npm install is required for the tests. The package is intentionally Git-distributed (`private: true`), while the suite also exercises the packed renderer from a `node_modules` layout to prevent install-path regressions. The entrypoint lifecycle harness uses test-only import hooks to mock the Pi host; the production extension still receives host peer packages from Pi.

An optional model-free integration check exercises Pi's real in-memory/persistent session managers, tree navigation, and fork hooks. Run it with a temporary agent directory and no session persistence so it does not load the installed extension or affect a live session:

```bash
tmp=$(mktemp -d)
PI_CODING_AGENT_DIR="$tmp" PI_OFFLINE=1 pi --offline --no-extensions --no-mcp \
  --no-skills --no-prompt-templates --no-context-files \
  -e ./index.ts -e ./test/helpers/pi-runtime-smoke.ts \
  --mode json --no-session /outline-history-smoke
rm -rf "$tmp"
```

Success prints `PI_HISTORY_RUNTIME_OK`; extension diagnostics must also be checked because a failed command can return a zero process status.

## Security and operational notes

- Extensions execute with the same OS permissions as Pi; review code before installing it.
- Outline text is stripped of ANSI and terminal control characters before rendering.
- tmux receives command arguments as separate arguments rather than a shell-built command string.
- The tmux pane is tagged with a per-session owner value and is killed only when ownership still matches.
- Observer instructions occupy one stable named system-prompt section while enabled. Pi records section deltas instead of repeated full-prompt replacements, although providers still receive the current system context on each stateless request.

## License

MIT
