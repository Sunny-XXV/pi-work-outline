# pi-work-outline

A Pi extension that asks the agent to maintain a compact, live work tree while it works. In a tmux session the outline opens in a side pane; elsewhere it uses a Pi widget. Headless sessions still maintain the Markdown observer file.

The outline is designed as operational context rather than a disposable todo list. When the user substantially redirects a task, the agent is instructed to compress the prior route in place, retain useful completed work, record the transition, and continue in the same tree.

## Features

- Toggle at startup with `--work-outline` or at runtime with `/work-outline`.
- Renders a small Markdown subset as a status-colored tree.
- Opens a dedicated tmux pane when possible and safely falls back to a Pi widget.
- Persists enabled state and the selected file on the active session branch.
- Reconstructs state after branch navigation.
- Uses Pi's configured agent directory for per-session state.
- Preserves prior work across major goal changes instead of resetting the outline.
- Runs without external runtime dependencies beyond Pi and Node.js.

## Install from GitHub

After this repository is published:

```bash
pi install git:https://github.com/Sunny-XXV/work-outline
```

For local development or a one-off run:

```bash
pi -e ./path/to/work-outline --work-outline
```

Pi provides `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`; do not install private copies into this repository.

## Usage

Start enabled:

```bash
pi --work-outline
```

Use a custom observer file (relative paths resolve from Pi's working directory):

```bash
pi --work-outline --work-outline-file .pi/work-outline.md
```

The `WORK_OUTLINE_FILE` environment variable is the fallback when `--work-outline-file` is absent. The precedence is:

1. `--work-outline-file`
2. `WORK_OUTLINE_FILE`
3. restored session path
4. `<agent-dir>/state/work-outlines/<session-id>.md`

Runtime commands:

```text
/work-outline          enable or show status
/work-outline on       enable
/work-outline off      disable
/work-outline status   show status
```

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
index.ts                Pi lifecycle, flags, command, prompt injection
prompt.md               Agent-facing continuity and outline policy
tmux-renderer.mjs       Standalone tmux process and terminal colors
src/config.ts           Pure path/state-precedence logic
src/outline.ts          Shared parser, tree layout, sanitation, wrapping
src/state.ts            Pi branch-state and configured-directory adapter
src/tmux.ts             tmux lifecycle, render mode, and pane ownership
src/widget.ts           Pi TUI component
test/                   Node built-in test suite
```

The standalone renderer imports the same parser and tree layout as the Pi widget so the two views cannot drift independently.

## Development

Requires Node.js 22.19 or newer, matching Pi 1.1.0's runtime floor.

```bash
npm test
npm run check
```

No npm install is required for the pure parser/configuration tests. Loading `index.ts` is integration-tested by Pi itself because its host-provided imports are resolved by Pi's extension loader.

## Security and operational notes

- Extensions execute with the same OS permissions as Pi; review code before installing it.
- Outline text is stripped of ANSI and terminal control characters before rendering.
- tmux receives command arguments as separate arguments rather than a shell-built command string.
- The tmux pane is tagged with a per-session owner value and is killed only when ownership still matches.
- The observer prompt is injected into every enabled model request. It is intentionally compact, but still has a context/cost tradeoff.

## License

MIT
