# Work Outline Observer

Maintain the injected observer file while executing the user's task. It is a compact navigation surface showing the current goal, completed stages, active route, nested investigations, blockers, and next step. It is not a substitute for doing the work.

## File contract

The absolute path is injected below. Use exactly that ordinary UTF-8 file. In TUI mode the extension renders it in tmux when available and otherwise in a Pi widget. Do not start your own renderer, watcher, pane, or background process.

Initialize the file before substantive investigation. Update it whenever the route, status, evidence, or requested outcome materially changes, and before waiting or reporting completion. After an update, continue the task.

Use only this Markdown subset:

- exactly two top-level headings: `# GOAL` and `# WORK`;
- `- ` list items;
- exactly two ASCII spaces per nesting level;
- no other headings, ordered lists, checkboxes, tables, fenced blocks, tree glyphs, ANSI codes, or manual alignment.

The renderer owns tree guides, status alignment, color, wrapping, and hanging indentation.

## Goal and work

Keep `GOAL` concise: current requested outcome, verification surface, and important constraints.

Put all execution state under `WORK` in process order. A work item starts with one status:

```text
TODO   not started
RUN    actively being worked
WAIT   launched and waiting for an external result
BLOCK  cannot proceed because a non-human dependency is unavailable
HUMAN  cannot proceed until the user or another human provides input or takes action
DONE   completed with an adequate conclusion or verification
HOLD   intentionally deferred; state why and when to resume
DROP   intentionally abandoned; state why
```

A supporting summary is a nested bullet without a status. Use short verb/object phrases for work nodes and put results or route-changing evidence beneath the work that produced them.

```markdown
# GOAL

- Verify the data flow and report actionable blockers.

# WORK

- RUN Inspect the data flow [main]
  - DONE Read the operating manual
    - Inspection order established.
  - RUN Check the latest upstream date
    - DONE Query source A
      - Latest ready date is 2026-10-08.
    - RUN Explain the missing partition
  - TODO Reconcile the chain and report health
```

Multiple `RUN` or `WAIT` nodes are allowed only when work is genuinely concurrent. Use `HUMAN`, not `BLOCK`, when a person must answer, approve, authenticate, decide, or act. Add ownership such as `[main]`, `[agent:compat]`, or `[worker:compile]` when useful. Never claim a process or subagent is running unless it was launched.

## Tree and process continuity

Indentation is the investigation stack. A child exists because advancing its parent requires it. When a nested question ends, set it to `DONE`, `HOLD`, `DROP`, or `BLOCK`, record the short result or stop reason, then continue at its parent. If an incidental question is unnecessary, mark it `HOLD` with a concrete resume condition instead of letting it replace the task.

Preserve check → observation → response causality:

- Name a node for the work attempted, not a result discovered afterward.
- Put the observation beneath the check that established it.
- Nest diagnosis, remediation, or retry beneath that observation-producing check.
- Keep sibling nodes at the same abstraction level.
- During compression, do not promote a response above its trigger or remove the observation needed to explain the route.

A reader should never meet an investigation or fix before seeing the check and observation that caused it.

```markdown
- DONE Check both data flows
  - DONE Check 0d
    - All required dates succeeded.
  - DONE Check 7d
    - Three dates were pending; all others succeeded.
    - DONE Investigate the pending dates
      - They share one failed direct dependency.
```

## Major goal changes

Treat a major goal change as a transition within one continuous work history, not permission to replace the file.

When the user substantially redirects the task:

1. Update `GOAL` to the current requested outcome.
2. Do not clear or recreate `WORK`. Mark the former active stage truthfully and compress it in place to the result or partial result worth retaining.
3. Add a short sibling transition node stating why the route changed and what prior work remains useful.
4. Start the new route as the next sibling and reuse retained evidence.

```markdown
# GOAL

- Deliver the newly requested dashboard.

# WORK

- HOLD Build the original report
  - User redirected after source validation; the source inventory remains useful.
- DONE Reconcile the direction change
  - Dashboard work supersedes report writing.
- RUN Build the dashboard
  - RUN Reuse the validated source inventory
```

Replacing all prior `WORK` content is allowed only when the user explicitly requests a reset, the file belongs to another task/session, or it is unusably corrupt. A changed goal by itself is not a reset condition.

## Size and evidence budget

Target 24–32 source lines and normally stay at or below 40. Before adding detail beyond the budget:

- keep the active path and immediate alternatives expanded;
- collapse an old completed subtree in place to its `DONE` node plus at most two result lines;
- retain any check → observation → response bridge still needed for causality;
- aggregate repeated dates, attempts, instances, tests, or agents when outcomes do not differ;
- preserve only identifiers and dates needed for the current route, verification, blocker, or handoff;
- fold a route when it stops being active instead of appending indefinitely.

This is situational awareness, not a shell transcript, durable evidence store, or final-report taxonomy. Do not copy commands, long outputs, routine successes, or facts cheaply recoverable from the session. Let the renderer wrap lines; optimize meaning, not manual column width.

A terminal node must include its result, stop reason, or verification. Changing `RUN` directly to `DONE` without a useful conclusion is insufficient. Every mentioned data-flow instance must include its business date when applicable.

## Completion

Before the final response:

1. Reconcile every active branch.
2. Mark the root work node `DONE`, `BLOCK`, or `HOLD` truthfully.
3. Do not mark the root `DONE` while required work remains `TODO`, `RUN`, `WAIT`, `BLOCK`, or `HUMAN`.
4. Leave the compact final route and conclusions in the observer file.
5. Ensure the final response agrees with it and identifies any unresolved node.
