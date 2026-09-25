# OMP ORC dispatch design

## Purpose and agreed outcome

Turn stock Oh My Pi (OMP) into a single-terminal orchestration host. The model selected for the main OMP session is the Supervisor, regardless of its provider. The Supervisor owns the user's objective, decides when specialist work is useful, verifies specialist findings, performs or coordinates implementation, runs appropriate checks, and gives the final answer. A specialist never becomes an independent owner of the task.

The user may explicitly direct a task to Claude CLI, Codex CLI, or a model available through an OMP provider. Such a direction takes precedence over automatic routing. With no direction, the Supervisor chooses the specialist and runtime according to task needs and the plugin's policy. Active user instructions and skills continue to govern the workflow; orchestration does not bypass their approval or review gates.

## Scope of this V1

V1 provides one dispatch interface with three runtime types: an OMP model, Claude CLI, and Codex CLI. The initial semantic roles are `architect`, `reviewer`, and `security-reviewer`. The same interface can accept more roles later. Tasks execute independently and sequentially; no specialist session persistence or resume is required. The plugin runs within stock OMP without a core fork.

B.AI is an optional OMP provider integration, not a prerequisite or the designated Supervisor. B.AI login, model discovery, and default DeepSeek selection belong to a separate design and implementation slice. V1 has no distributed scheduler, parallel specialists, isolated worktrees, automatic fallback, quota-aware routing, dashboard, or autonomous loops.

## Architecture

An OMP extension adds Supervisor guidance to the main session and registers one LLM-callable tool, `orc_dispatch`. It does not replace the selected main model. The tool is the sole ORC entry point for specialist execution and owns runtime resolution, authorization, cancellation, and result normalization.

The request contains:

- `task`: a bounded instruction and expected deliverable;
- `role`: an advisory semantic role;
- `runtime`: `auto`, `omp-model`, `claude-cli`, or `codex-cli`;
- `model`: an optional provider/model selector for `omp-model`, or a runtime-supported model selector for a CLI;
- `complexity`: `trivial`, `normal`, `hard`, or `critical` for policy mapping;
- `permission`: `read` by default, or explicit `write`;
- `context`: concise objective, relevant file paths or diff, and known test results when appropriate.

The Supervisor does not need to construct CLI commands or model-specific effort flags. A policy resolver maps role, runtime, complexity, and installed capabilities to an actual invocation. It rejects unsupported combinations rather than silently switching the requested runtime or model. The user's explicit target is preserved by the Supervisor in the dispatch request. `auto` is permitted only when the user gave no target; its decision and resolved runtime are returned in the result.

The initial default policy favors Claude CLI for architecture advice and Codex CLI for correctness or security review. An `omp-model` request uses the specified configured model; when no model is specified, it uses a configured role model or, if none exists, the main session's model. These are defaults, not fixed assignments. No model or provider name is hard-coded as the Supervisor.

## Runtime components

`omp-model` runs a restricted specialist session against a configured OMP provider/model. The design should use OMP's supported extension and task/session APIs where possible; the implementation plan must confirm the stable API surface and pin a compatible OMP version before choosing an invocation path. The requested model must exist in OMP's model registry. A read task receives only read-capable tools.

`claude-cli` and `codex-cli` spawn the user's installed official executables with the task working directory, selected model/effort when supported, and explicit permission settings. Official CLIs retain ownership of their authentication and subscriptions. The plugin does not read, copy, or forward their credentials. It streams progress into the tool update callback and captures a bounded final result. It never uses a CLI mode that requires separate API-key authentication when the user's normal CLI session is the intended credential source.

The adapter boundary exposes `run(request, signal, onUpdate)` and returns a normalized result. CLI-specific JSON or JSONL events, exit codes, and stderr stay within the adapter. The result includes `status`, `role`, resolved `runtime`, resolved `model` when known, `permission`, final content or structured findings, and a short normalized error when execution fails. The Supervisor treats all successful content as advisory and verifies material claims against the workspace before acting on them.

## Data flow and precedence

1. The main OMP model receives the user's objective and applicable skill instructions.
2. The Supervisor decides whether a specialist materially helps. Trivial work may be handled directly.
3. If the user named a runtime or model, the Supervisor passes that choice to `orc_dispatch`. Otherwise it chooses a role and may leave runtime as `auto`.
4. The tool validates the request, resolves the runtime and effort, then runs one specialist.
5. The adapter reports progress and returns a bounded normalized result in the same OMP session.
6. The Supervisor checks findings, carries out or coordinates further work, validates the outcome, and answers the user.

Explicit user instructions outrank routing defaults. Skill constraints, including required design approvals, remain binding. A policy rejection or unavailable requested runtime is surfaced to the Supervisor; there is no silent fallback in V1.

## Permission and isolation policy

Specialists default to read-only. Read-only is enforced by runtime capabilities rather than prompt wording: OMP specialist sessions receive a restricted read tool set; Codex CLI uses its read-only sandbox; Claude CLI is launched with an allowlist of read tools and without write-capable tools. The implementation plan must verify the exact current CLI flags and test that each adapter rejects a write attempt. If a CLI cannot provide that boundary with the selected mode, the adapter fails closed for read-only tasks.

A write task requires `permission: write` in the dispatch call. V1 allows only one active specialist at a time, so at most one specialist writer exists within the plugin. The Supervisor awaits its result before making further workspace changes. This is an ORC execution rule, not a filesystem lock against unrelated external programs. A writing specialist may edit the working tree directly; its result must list changed paths, and the Supervisor inspects the diff and runs relevant checks before accepting the work. A write task does not grant the specialist authority to finalize the user's request.

No credential is included in specialist prompts or logs. Full prompts and raw stderr are not written to plugin logs.

## Cancellation, failures, and reporting

OMP's tool abort signal propagates to the running adapter. A canceled CLI receives a graceful termination signal and is force-stopped after a short grace period; stdout/stderr readers are closed and the tool returns `USER_ABORT`. A per-task timeout follows the same cleanup path and returns `PROCESS_TIMEOUT`. The OMP-model adapter cancels its restricted session through the supported OMP mechanism.

Adapters normalize at least `CLI_NOT_FOUND`, `AUTH_REQUIRED`, `RATE_LIMIT`, `QUOTA_EXHAUSTED`, `PROCESS_TIMEOUT`, `PROCESS_EXIT_ERROR`, `MALFORMED_OUTPUT`, `MODEL_UNAVAILABLE`, and `USER_ABORT`. A failure result includes runtime, reason, retryability, and a short safe message. It does not flood Supervisor context with raw CLI output. Local logs record role, resolved runtime/model, start and end, duration, and status, omitting credentials and full task text.

## Verification and acceptance

Automated tests use fake runtime processes and a fake OMP-model executor to prove routing precedence, unsupported-target rejection, permission defaults, writer exclusivity, output normalization, timeout, abort cleanup, and error mapping. Permission tests include an attempted write in every read-only runtime. Tests check behavior at the adapter boundary rather than echoing implementation details.

A local smoke test uses an installed OMP plus authenticated official CLIs. It verifies that a main session using an arbitrary configured OMP model can dispatch one OMP-model specialist and one specialist through each CLI, receive results in the same terminal, and continue to a Supervisor-owned final answer. A user-named runtime/model is honored, and cancellation leaves no child process. The implementation plan must identify how to run this smoke test without requiring real subscriptions in automated CI.

V1 is complete when these paths work end to end, read-only boundaries hold, write delegation is explicit and sequential, failures are understandable, and the Supervisor remains responsible for validation and the final response.

## Documentation basis and implementation checks

OMP documents runtime provider registration, extension tools, prompt lifecycle hooks, plugin agent discovery, restricted sessions, and task agent dispatch. These support the proposed plugin direction but do not alone establish a stable public API for every internal task primitive. The implementation plan should verify API stability against the version used for development before coding the OMP-model adapter.

- OMP extensions: https://github.com/can1357/oh-my-pi/blob/main/docs/extensions.md
- OMP task agent discovery: https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md
- OMP SDK: https://github.com/can1357/oh-my-pi/blob/main/docs/sdk.md
- Codex noninteractive CLI: https://github.com/openai/codex/blob/main/codex-rs/exec/src/cli.rs
- Claude Code CLI project: https://github.com/anthropics/claude-code
