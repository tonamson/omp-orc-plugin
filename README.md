# OMP ORC Plugin

ORC adds a Supervisor workflow to stock Oh My Pi. Whichever model is selected in the main OMP session remains the Supervisor. It can call one specialist through an OMP provider model, Claude Code CLI, or Codex CLI and then verify the result in the same terminal.

## Requirements

- OMP 18.3.1
- Node.js 24 or newer for local tests
- Official `claude` and `codex` commands for their respective runtimes, signed in through those CLIs
- An authenticated OMP model for the main session; an additional provider model if you want an `omp-model` specialist

The plugin does not inspect CLI subscription tokens. It does not install or authenticate providers for you.

## Develop and load

```sh
npm install
npm test
npm run typecheck
omp --plugin-dir .
```

Select any configured main model with OMP's `/models` command. The extension appends Supervisor guidance and registers `orc_dispatch`; it does not switch the main model. You can link the plugin for normal use with `omp plugin link /absolute/path/to/omp-orc-plugin`.

## Try it

In the OMP terminal:

```text
Ask the architect through Claude CLI for two ways to structure this module. Summarize the tradeoffs yourself.
```

```text
Review my current diff through Codex CLI for correctness. Verify each finding before you report it.
```

```text
Use the OMP model deepseek/deepseek-v4 as security-reviewer to audit the current auth changes. Verify its findings yourself.
```

Replace `deepseek/deepseek-v4` with an actual provider/model shown by `/models`. A user-named runtime or model takes precedence over the plugin's default role routing.

## Permissions

Specialists default to read-only. Codex uses its read-only sandbox. Claude runs with a restricted `Read,Grep,Glob` tool set. An OMP model specialist gets only OMP's `read`, `grep`, and `glob` tools in a restricted child session. To delegate an edit, the Supervisor must call `orc_dispatch` with `permission: write`; V1 supports this through Claude or Codex CLI, one task at a time. OMP-model write requests currently fail closed because a confined write boundary has not been verified.

You can probe the boundary by asking each read-only specialist to create a marker file in a disposable directory, then checking that the file is absent. Press Ctrl+C during a long task to test cancellation and check that its child process stops. The Supervisor must inspect any changed paths and run appropriate checks after a writing specialist returns.

## Verification

`npm test` runs fake-process and adapter boundary tests without using subscriptions. `npm run typecheck` checks this plugin's TypeScript. A full local smoke test needs authenticated Claude and Codex CLIs plus at least one configured OMP model. Run the three prompts above, inspect the reported runtime and result, and verify the Supervisor continues in the same OMP terminal. The plugin logs only role, runtime/model, duration, and status to stderr; it does not log task text or credentials.

V1 does not register B.AI, persist specialist sessions, run specialists in parallel, create worktrees for workers, or silently switch runtimes when one is unavailable.
