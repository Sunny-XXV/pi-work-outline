# pi-work-outline

A Pi extension that asks the agent to maintain a compact, live work tree while it works. In a tmux session the outline opens in a side pane; elsewhere it uses a Pi widget. Headless sessions still maintain the Markdown observer file.

The outline is designed as operational context rather than a disposable todo list. When the user substantially redirects a task, the agent is instructed to compress the prior route in place, retain useful completed work, record the transition, and continue in the same tree.

## Features

- Toggle at runtime with `/work-outline` and restore the saved state on later session loads.
- Renders a small Markdown subset as a status-colored tree.
- Opens a dedicated tmux pane when possible and safely falls back to a bounded Pi widget.
- Provides `/work-outline view` for a focusable, scrollable view of the full current outline.
- Persists enabled state and the selected file on the active session branch.
- Reconstructs state after branch navigation.
- Uses Pi's configured agent directory for per-session state.
- Preserves prior work across major goal changes instead of resetting the outline.
- Runs without external runtime dependencies beyond Pi and Node.js.

## Install from GitHub

After this repository is published:

```bash
pi install git:https://github.com/Sunny-XXV/pi-work-outline
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

`defaultRenderer` accepts `tmux`, `auto`, or `widget`. `tmux` is the compatibility-preserving default. `tmux` and `auto` attempt tmux first and fall back to the native widget; `widget` skips tmux. `tmuxSplitPercent` accepts an integer from 10 through 80. Invalid values use the defaults shown above. The earlier draft names `renderer` and `tmuxPanePercent` are also accepted for compatibility. Run `/reload` after editing settings.

The widget displays at most eight rows and links to `/work-outline view`; the viewer shows the full current outline with arrow, Page Up/Down, Home, and End scrolling. Escape or `q` closes it. A tmux refresh clears stale pane history before drawing the full current document, so scrollback does not accumulate older versions.

## Observer format

The agent writes only two headings and `- ` list items, with two spaces per nesting level:

```markdown
# GOAL

- Deliver a reviewed implementation.

# WORK

- DONE Inspect the current implementation
  - Found one reusable parser and two duplicated render paths.
- RUN Refactor the renderer
  - TODO Run regression tests
```

Supported status labels are `TODO`, `RUN`, `WAIT`, `BLOCK`, `DONE`, `HOLD`, and `DROP`.

## Design

```text
index.ts                Pi lifecycle, commands, and prompt section
prompt.md               Agent-facing continuity and outline policy
bin/tmux-renderer.mjs   Standalone tmux process and terminal colors
src/config.ts           Pure path/state-precedence logic
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

No npm install is required for the tests. The package is intentionally Git-distributed (`private: true`), while the suite also exercises the packed renderer from a `node_modules` layout to prevent install-path regressions. Pi provides the host peer packages when loading `index.ts`.

## Security and operational notes

- Extensions execute with the same OS permissions as Pi; review code before installing it.
- Outline text is stripped of ANSI and terminal control characters before rendering.
- tmux receives command arguments as separate arguments rather than a shell-built command string.
- The tmux pane is tagged with a per-session owner value and is killed only when ownership still matches.
- Observer instructions occupy one stable named system-prompt section while enabled. Pi records section deltas instead of repeated full-prompt replacements, although providers still receive the current system context on each stateless request.

## License

MIT
