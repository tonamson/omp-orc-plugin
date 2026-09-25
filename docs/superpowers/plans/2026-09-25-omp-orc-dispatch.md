# OMP ORC Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any selected OMP main model supervise tasks and dispatch read-only or explicitly writable specialists through an OMP model, Claude CLI, or Codex CLI in the same terminal.

**Architecture:** An OMP extension injects Supervisor guidance and exposes one `orc_dispatch` tool. A pure resolver chooses a runtime and maps effort; three adapters share a result and cancellation contract. The OMP adapter creates a restricted SDK session using the existing model registry and auth storage; CLI adapters spawn official executables. Dispatch is sequential and specialist output remains advisory.

**Tech Stack:** TypeScript, Node.js 24, `@oh-my-pi/pi-coding-agent@18.3.1`, `tsx@4.23.15`, TypeScript 5.9, Node's `node:test`, stock OMP 18.3.1, installed Claude Code and Codex CLI.

**Spec:** `docs/superpowers/specs/2026-09-25-omp-orc-dispatch-design.md`

## Global Constraints

- The selected main OMP model is Supervisor; no provider or model is hard-coded for that role.
- Explicit user runtime/model directions outrank automatic routing; unsupported targets fail visibly without fallback.
- Specialists default to `read`; `write` must be explicit, with one active specialist at a time.
- Read permission uses a restricted tool or sandbox boundary, not prompt text alone.
- Official CLI installations own their credentials; never read or log their tokens.
- B.AI registration, specialist resume, parallelism, worktrees, fallback, and dashboards are outside this plan.
- Do not fork OMP. Do not use Claude `--bare`, because it disables OAuth/keychain authentication on the installed CLI.

## Review Focus

1. An explicit provider/model that is absent from OMP's authenticated registry must return `MODEL_UNAVAILABLE`; Task 4 tests it.
2. A CLI executable that is missing or exits before producing a final message must return a bounded normalized error; Tasks 2 and 3 test it.
3. A read-only task that asks the specialist to write a file must leave the workspace unchanged; Tasks 3 and 4 test it.
4. Abort or timeout during streaming must terminate the child process and release the dispatch lock; Tasks 2 and 5 test it.
5. A second dispatch attempted while one specialist is active must fail predictably, including a second writer; Task 5 tests it.

---

## File map

| Path | Responsibility |
| --- | --- |
| `package.json`, `tsconfig.json` | OMP extension manifest, local typecheck and test commands |
| `src/contracts.ts` | Request, resolved task, result, error, and adapter interfaces |
| `src/policy.ts` | Pure validation, runtime choice, model and effort resolution |
| `src/roles.ts` | Role-specific advisory instructions and bounded task/context prompt |
| `src/process.ts` | Child process spawn, bounded line parsing, timeout, abort, cleanup |
| `src/cli/claude.ts`, `src/cli/codex.ts` | CLI argument policy and output normalization |
| `src/omp-model.ts` | Restricted OMP SDK child session |
| `src/dispatch.ts` | One-at-a-time execution, adapter selection, safe result formatting |
| `src/logging.ts` | Small secret-free local lifecycle events |
| `src/index.ts` | OMP lifecycle hook and `orc_dispatch` registration |
| `src/supervisor-prompt.ts` | Supervisor instructions that preserve user and skill constraints |
| `tests/*.test.ts` | Contract tests, fake-process tests, adapter tests, and extension tests |
| `README.md` | Install, use, permission model, and live smoke procedure |

### Task 1: Package, contracts, and pure routing policy

**Files:** Create `package.json`, `tsconfig.json`, `src/contracts.ts`, `src/policy.ts`, `src/roles.ts`, `tests/policy.test.ts`.

**Interfaces:** Produces `DispatchRequest`, `ResolvedTask`, `DispatchResult`, `RuntimeAdapter`, `resolveTask(request, environment)`, and `buildSpecialistPrompt(task)`. Later tasks import these exact names.

- [ ] **Step 1: Write the failing policy tests.** Cover explicit runtime/model precedence, default role routing, default read permission, unsupported model, and no silent fallback.

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTask } from "../src/policy.ts";
import { buildSpecialistPrompt } from "../src/roles.ts";

const env = { currentModel: "openai/gpt-5.4", roleModels: {}, hasModel: (id: string) => id === "deepseek/deepseek-v4" || id === "openai/gpt-5.4" };
test("explicit OMP model beats reviewer default", () => {
  const task = resolveTask({ task: "review", role: "reviewer", runtime: "omp-model", model: "deepseek/deepseek-v4" }, env);
  assert.equal(task.runtime, "omp-model");
  assert.equal(task.model, "deepseek/deepseek-v4");
  assert.equal(task.permission, "read");
});
test("unknown explicit model does not fall back", () => {
  assert.throws(() => resolveTask({ task: "review", role: "reviewer", runtime: "omp-model", model: "missing/model" }, env), /MODEL_UNAVAILABLE/);
});
test("auto routes known roles without binding Supervisor", () => {
  assert.equal(resolveTask({ task: "design", role: "architect", runtime: "auto" }, env).runtime, "claude-cli");
  assert.equal(resolveTask({ task: "audit", role: "security-reviewer", runtime: "auto" }, env).runtime, "codex-cli");
});
test("role prompt carries context and advisory boundary", () => {
  const prompt = buildSpecialistPrompt({ ...resolveTask({ task: "Audit auth", role: "security-reviewer", runtime: "auto", context: "Changed file: src/auth.ts" }, env), cwd: process.cwd() });
  assert.match(prompt, /Changed file: src\/auth\.ts/);
  assert.match(prompt, /advisory/i);
  assert.match(prompt, /security/i);
});
```

- [ ] **Step 2: Run `node --import tsx --test tests/policy.test.ts`.** Expected: failure because `src/policy.ts` does not exist.
- [ ] **Step 3: Add package setup and contract types.** Use the package manifest below; the lockfile is created by `npm install` and committed with this task.

```json
{
  "name": "omp-orc-plugin",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --import tsx --test tests/*.test.ts",
    "typecheck": "tsc --noEmit"
  },
  "omp": { "extensions": ["./src/index.ts"] },
  "dependencies": { "@oh-my-pi/pi-coding-agent": "18.3.1" },
  "devDependencies": { "tsx": "4.23.15", "typescript": "~5.9.3", "@types/node": "^24.0.0" }
}
```

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

```ts
// src/contracts.ts
export type Runtime = "auto" | "omp-model" | "claude-cli" | "codex-cli";
export type Permission = "read" | "write";
export type Complexity = "trivial" | "normal" | "hard" | "critical";
export type Role = "architect" | "reviewer" | "security-reviewer";
export type ErrorCode = "CLI_NOT_FOUND" | "AUTH_REQUIRED" | "RATE_LIMIT" | "QUOTA_EXHAUSTED" | "PROCESS_TIMEOUT" | "PROCESS_EXIT_ERROR" | "MALFORMED_OUTPUT" | "MODEL_UNAVAILABLE" | "USER_ABORT" | "BUSY" | "INVALID_REQUEST";
export interface DispatchRequest { task: string; role: Role; runtime: Runtime; model?: string; complexity?: Complexity; permission?: Permission; context?: string }
export interface ResolvedTask extends DispatchRequest { runtime: Exclude<Runtime, "auto">; permission: Permission; complexity: Complexity; model?: string; effort?: string; cwd: string }
export interface DispatchError { code: ErrorCode; message: string; retryable: boolean }
export interface DispatchResult { status: "completed" | "failed"; role: Role; runtime: Runtime; model?: string; permission: Permission; content?: string; changedPaths?: string[]; error?: DispatchError }
export type Progress = (text: string) => void;
export interface RuntimeAdapter { run(task: ResolvedTask, signal: AbortSignal, onProgress: Progress): Promise<DispatchResult> }
```

- [ ] **Step 4: Implement `resolveTask` with table-based defaults and model validation.** `auto` routes architect to Claude and reviewer/security-reviewer to Codex. For explicit `omp-model`, resolve `model` from the request, role config, then current main model. Reject a CLI model string containing `/` because it denotes an OMP provider selector.

```ts
import type { DispatchRequest, ResolvedTask, Role } from "./contracts.ts";
export interface RoutingEnvironment { currentModel?: string; roleModels: Partial<Record<Role, string>>; hasModel(id: string): boolean; cwd?: string }
const defaultRuntime = { architect: "claude-cli", reviewer: "codex-cli", "security-reviewer": "codex-cli" } as const;
const effort = { architect: { normal: "high", hard: "xhigh", critical: "max" }, reviewer: { normal: "high", hard: "xhigh", critical: "max" }, "security-reviewer": { normal: "xhigh", hard: "xhigh", critical: "max" } } as const;
export function resolveTask(request: DispatchRequest, env: RoutingEnvironment): ResolvedTask {
  if (!request.task.trim()) throw new Error("INVALID_REQUEST: task is empty");
  const runtime = request.runtime === "auto" ? defaultRuntime[request.role] : request.runtime;
  const complexity = request.complexity ?? "normal";
  const permission = request.permission ?? "read";
  const model = runtime === "omp-model" ? request.model ?? env.roleModels[request.role] ?? env.currentModel : request.model;
  if (runtime === "omp-model" && (!model || !env.hasModel(model))) throw new Error("MODEL_UNAVAILABLE: selected model is unavailable");
  if (runtime !== "omp-model" && model?.includes("/")) throw new Error("INVALID_REQUEST: CLI model cannot be an OMP provider/model selector");
  const tier = complexity === "trivial" ? "normal" : complexity;
  return { ...request, runtime, model, complexity, permission, effort: runtime === "omp-model" ? undefined : effort[request.role][tier], cwd: env.cwd ?? process.cwd() };
}
```

```ts
// src/roles.ts
import type { ResolvedTask } from "./contracts.ts";
const roleInstruction = {
  architect: "Analyze architecture, tradeoffs, risks, and a concrete plan.",
  reviewer: "Review correctness, regressions, edge cases, and maintainability. Cite file and line for findings.",
  "security-reviewer": "Audit trust boundaries, auth, injection, secrets, and data safety. Give severity, file, line, evidence, and remediation."
} as const;
export function buildSpecialistPrompt(task: ResolvedTask): string {
  return `${roleInstruction[task.role]}\nYour result is advisory; the OMP Supervisor verifies it and owns the final task.\nPermission: ${task.permission}.\nTask: ${task.task}\nContext: ${task.context ?? "None supplied"}`;
}
```

- [ ] **Step 5: Run `npm install`, `npm test`, and `npm run typecheck`.** Expected: policy tests pass and TypeScript reports no errors.
- [ ] **Step 6: Commit.** `git add package.json package-lock.json tsconfig.json src/contracts.ts src/policy.ts src/roles.ts tests/policy.test.ts` then `git commit -m "feat: define ORC dispatch policy"`.

### Task 2: Cancellable, bounded process runner

**Files:** Create `src/process.ts`, `tests/process.test.ts`.

**Interfaces:** Produces `runJsonLines(binary, args, options)` returning `{ lines: unknown[]; stderr: string; exitCode: number }`; options contain `cwd`, `stdin`, `signal`, `timeoutMs`, `onProgress`, `maxBytes`. Task 3 supplies CLI commands.

- [ ] **Step 1: Write failing fake-process tests.** Use `process.execPath` with `-e` as the fake executable; cover JSONL parsing, malformed line, bounded output, missing binary, abort and timeout. Check a process marker file is not written after abort.

```ts
test("abort kills child and stops later work", async () => {
  const controller = new AbortController();
  const pending = runJsonLines(process.execPath, ["-e", "setTimeout(() => process.stdout.write('{}\\n'), 10000)"], { cwd: process.cwd(), stdin: "", signal: controller.signal, timeoutMs: 20000, maxBytes: 4096, onProgress() {} });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, /USER_ABORT/);
});
test("missing executable has one error code", async () => {
  await assert.rejects(runJsonLines("__orc_missing_binary__", [], { cwd: process.cwd(), stdin: "", signal: new AbortController().signal, timeoutMs: 1000, maxBytes: 4096, onProgress() {} }), /CLI_NOT_FOUND/);
});
```

- [ ] **Step 2: Run `node --import tsx --test tests/process.test.ts`.** Expected: failure because `runJsonLines` is absent.
- [ ] **Step 3: Implement with `node:child_process.spawn` and `node:readline`.** Write the task to stdin, parse complete stdout lines, cap stdout and stderr separately, forward concise progress, and classify `ENOENT`, malformed JSON, excess bytes, abort, timeout and nonzero exit. On abort/timeout send `SIGTERM`, then `SIGKILL` after 2 seconds; clear timers and listeners in `finally`.

```ts
const child = spawn(binary, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
child.stdin.end(options.stdin);
const stop = () => { child.kill("SIGTERM"); forceTimer = setTimeout(() => child.kill("SIGKILL"), 2000); };
options.signal.addEventListener("abort", stop, { once: true });
// Consume stdout line-by-line; JSON.parse each nonblank line; never retain more than maxBytes.
// Await child close, remove abort listener, clear timeout and forceTimer.
```

- [ ] **Step 4: Run `node --import tsx --test tests/process.test.ts` and `npm run typecheck`.** Expected: all process tests pass.
- [ ] **Step 5: Commit.** `git add src/process.ts tests/process.test.ts` then `git commit -m "feat: add cancellable CLI runner"`.

### Task 3: Official Claude and Codex CLI adapters

**Files:** Create `src/cli/claude.ts`, `src/cli/codex.ts`, `tests/cli.test.ts`.

**Interfaces:** Produce `claudeAdapter` and `codexAdapter`, each satisfying `RuntimeAdapter`. They call Task 2's `runJsonLines`; their output is `DispatchResult` from Task 1.

- [ ] **Step 1: Write failing adapter tests with injected `runJsonLines`.** Assert exact read/write flags, selected model and effort, final-message extraction, explicit auth/limit/exit errors, and that a read task asking to write a file gets no write-capable CLI flags. A fake runner returns representative Claude `result` and Codex `item.completed`/`turn.completed` lines.

```ts
const readTask: ResolvedTask = { task: "Review and try to create marker.txt", role: "reviewer", runtime: "codex-cli", permission: "read", complexity: "normal", cwd: process.cwd() };
test("Claude read task exposes only read tools", async () => {
  const adapter = createClaudeAdapter(async (_bin, args) => {
    assert.deepEqual(args.slice(0, 9), ["-p", "--output-format", "stream-json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob", "--model"]);
    assert.equal(args.includes("--bare"), false);
    return { lines: [{ type: "result", result: "reviewed" }], stderr: "", exitCode: 0 };
  });
  const result = await adapter.run({ ...readTask, runtime: "claude-cli" }, new AbortController().signal, () => {});
  assert.equal(result.content, "reviewed");
});
test("Codex read task uses sandbox", async () => {
  const adapter = createCodexAdapter(async (_bin, args) => {
    assert.ok(args.includes("read-only"));
    assert.equal(args.includes("danger-full-access"), false);
    return { lines: [{ type: "item.completed", item: { type: "agent_message", text: "safe" } }, { type: "turn.completed" }], stderr: "", exitCode: 0 };
  });
  assert.equal((await adapter.run(readTask, new AbortController().signal, () => {})).content, "safe");
});
```

- [ ] **Step 2: Run `node --import tsx --test tests/cli.test.ts`.** Expected: failure because adapter factories do not exist.
- [ ] **Step 3: Implement Claude adapter.** Use `claude -p --output-format stream-json --no-session-persistence --restricted --strict-mcp-config --tools Read,Grep,Glob --model <model> --effort <mapped effort>` for read; write uses a separate explicit tools/permission configuration without `--restricted`. Send prompt through stdin, avoid `--bare`, parse only the final `result` event, and map safe error messages.

```ts
export function createClaudeAdapter(run = runJsonLines): RuntimeAdapter {
  return { async run(task, signal, onProgress) {
    const args = task.permission === "read" ? ["-p", "--output-format", "stream-json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob"] : ["-p", "--output-format", "stream-json", "--no-session-persistence", "--permission-mode", "acceptEdits"];
    if (task.model) args.push("--model", task.model);
    if (task.effort) args.push("--effort", task.effort);
    const output = await run("claude", args, { cwd: task.cwd, stdin: buildSpecialistPrompt(task), signal, timeoutMs: 300000, maxBytes: 2_000_000, onProgress });
    const final = output.lines.findLast((line: any) => line?.type === "result");
    if (!final || typeof (final as any).result !== "string") throw new Error("MALFORMED_OUTPUT: Claude result missing");
    return { status: "completed", role: task.role, runtime: task.runtime, model: task.model, permission: task.permission, content: (final as any).result };
  } };
}
```

- [ ] **Step 4: Implement Codex adapter.** Use `codex exec --json --ephemeral --sandbox read-only -C <cwd> -c model_reasoning_effort=<effort>` for read; use `workspace-write` only for explicit write. Add `-m` when specified. Parse the last agent message from JSONL and require `turn.completed`.

```ts
const args = ["exec", "--json", "--ephemeral", "--sandbox", task.permission === "read" ? "read-only" : "workspace-write", "-C", task.cwd];
if (task.model) args.push("-m", task.model);
if (task.effort) args.push("-c", `model_reasoning_effort=${task.effort}`);
const output = await run("codex", args, { cwd: task.cwd, stdin: buildSpecialistPrompt(task), signal, timeoutMs: 300000, maxBytes: 2_000_000, onProgress });
const final = output.lines.findLast((line: any) => line?.type === "item.completed" && line.item?.type === "agent_message");
if (!output.lines.some((line: any) => line?.type === "turn.completed") || !final) throw new Error("MALFORMED_OUTPUT: Codex final message missing");
```

- [ ] **Step 5: Run `npm test` and `npm run typecheck`.** Expected: CLI tests pass. Run a read-only live probe for each CLI in a temporary directory with a prompt asking it to create a marker file; the file must not appear. If the installed CLI ignores a required restrictive flag, fail the task and revise the adapter before proceeding.
- [ ] **Step 6: Commit.** `git add src/cli tests/cli.test.ts` then `git commit -m "feat: bridge Claude and Codex CLIs"`.

### Task 4: Restricted OMP-model specialist adapter

**Files:** Create `src/omp-model.ts`, `tests/omp-model.test.ts`.

**Interfaces:** Produce `createOmpModelAdapter(context)` satisfying `RuntimeAdapter`; `context` exposes the current extension `modelRegistry`, `models.resolve`, and cwd. Task 5 uses it.

- [ ] **Step 1: Write failing tests.** Inject a fake `createAgentSession` to assert explicit provider/model selection, `toolNames: ["read", "grep", "glob"]` for read, `restrictToolNames: true`, `SessionManager.inMemory()`, and abort/dispose. Check absent model returns `MODEL_UNAVAILABLE`.

```ts
const readTask: ResolvedTask = { task: "Review and try to create marker.txt", role: "reviewer", runtime: "omp-model", permission: "read", complexity: "normal", cwd: process.cwd() };
const selected = { provider: "deepseek", id: "deepseek-v4" };
const fakeContext = { models: { current: () => selected, resolve: (id: string) => id === "deepseek/deepseek-v4" ? selected : undefined }, modelRegistry: { authStorage: {} }, cwd: process.cwd() };
const fakeSession = { subscribe: () => () => {}, prompt: async () => {}, waitForIdle: async () => {}, abort: () => {}, dispose: async () => {} };
const fakeSessionFactory = Object.assign(async (options: unknown) => { fakeSessionFactory.calls.push(options); return { session: fakeSession }; }, { calls: [] as any[] });
test("explicit provider model resolves exactly and gets read tools", async () => {
  const adapter = createOmpModelAdapter(fakeContext, fakeSessionFactory);
  await adapter.run({ ...readTask, runtime: "omp-model", model: "deepseek/deepseek-v4" }, new AbortController().signal, () => {});
  assert.equal(fakeSessionFactory.calls[0].model.provider, "deepseek");
  assert.deepEqual(fakeSessionFactory.calls[0].toolNames, ["read", "grep", "glob"]);
  assert.equal(fakeSessionFactory.calls[0].restrictToolNames, true);
});
test("unavailable model fails without substituting current model", async () => {
  await assert.rejects(createOmpModelAdapter(fakeContext, fakeSessionFactory).run({ ...readTask, runtime: "omp-model", model: "missing/model" }, new AbortController().signal, () => {}), /MODEL_UNAVAILABLE/);
});
```

- [ ] **Step 2: Run `node --import tsx --test tests/omp-model.test.ts`.** Expected: missing adapter failure.
- [ ] **Step 3: Implement with OMP 18.3.1 public SDK.** Resolve via `ctx.models.resolve()`, pass `ctx.modelRegistry` and its matching auth storage to `createAgentSession`, use `SessionManager.inMemory()`, set `restrictToolNames: true`, no ambient extensions/MCP, subscribe to text deltas, call `session.prompt()`, await `session.waitForIdle()` with an external deadline, then unsubscribe and `dispose()` in `finally`. On signal abort call the session's supported abort method and return `USER_ABORT`. For write, allow `read`, `grep`, `glob`, `edit`, `write`, and `bash` only if the SDK's restriction actually confines them to cwd; otherwise reject `write` for this runtime until that boundary is proven.

```ts
const selected = task.model ? ctx.models.resolve(task.model) : ctx.models.current();
if (!selected) throw new Error("MODEL_UNAVAILABLE: selected OMP model is not available");
  const { session } = await createAgentSession({ model: selected, modelRegistry: ctx.modelRegistry, authStorage: ctx.modelRegistry.authStorage, sessionManager: SessionManager.inMemory(), toolNames: task.permission === "read" ? ["read", "grep", "glob"] : ["read", "grep", "glob", "edit", "write", "bash"], restrictToolNames: true });
  await session.prompt(buildSpecialistPrompt(task));
```

- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: adapter tests pass. In a local OMP session, verify one configured non-default provider model can be invoked through this adapter without separately providing credentials; read-mode write probe leaves no marker file.
- [ ] **Step 5: Commit.** `git add src/omp-model.ts tests/omp-model.test.ts` then `git commit -m "feat: dispatch restricted OMP model"`.

### Task 5: Extension wiring, dispatch lock, and user instructions

**Files:** Create `src/dispatch.ts`, `src/index.ts`, `src/supervisor-prompt.ts`, `src/logging.ts`, `tests/dispatch.test.ts`, `tests/extension.test.ts`, `README.md`.

**Interfaces:** `createDispatcher(adapters, resolveEnvironment)` returns a function `(request, context, signal, onProgress) => Promise<DispatchResult>`; `src/index.ts` is the extension's default export.

- [ ] **Step 1: Write failing dispatch and extension tests.** Prove one active run, lock release after abort/error, explicit `write` required, user-selected runtime/model preserved, safe failure details, and `before_agent_start` prompt injection. Inspect tool registration with a fake `ExtensionAPI`. Capture lifecycle logs and assert that a task containing `secret-token-123` never prints that text.

```ts
const request: DispatchRequest = { task: "Review this diff", role: "reviewer", runtime: "codex-cli" };
const context = { cwd: process.cwd(), models: { current: () => ({ provider: "openai", id: "gpt-5.4" }), resolve: () => undefined } };
let finishFirst!: () => void;
let runs = 0;
const adapter: RuntimeAdapter = { run: task => new Promise(resolve => { const done = () => resolve({ status: "completed", role: task.role, runtime: task.runtime, permission: task.permission, content: "done" }); if (++runs === 1) finishFirst = done; else done(); }) };
const dispatcher = createDispatcher({ "codex-cli": adapter, "claude-cli": adapter, "omp-model": adapter }, () => context);
test("second dispatch is BUSY until first settles", async () => {
  const first = dispatcher(request, context, new AbortController().signal, () => {});
  const second = await dispatcher(request, context, new AbortController().signal, () => {});
  assert.equal(second.error?.code, "BUSY");
  finishFirst();
  await first;
  assert.equal((await dispatcher(request, context, new AbortController().signal, () => {})).status, "completed");
});
test("Supervisor prompt preserves explicit user and skill constraints", () => {
  assert.match(supervisorPrompt, /user.*runtime|runtime.*user/i);
  assert.match(supervisorPrompt, /skill.*approval/i);
  assert.match(supervisorPrompt, /verify.*finding/i);
});
```

- [ ] **Step 2: Run `node --import tsx --test tests/dispatch.test.ts tests/extension.test.ts`.** Expected: missing dispatcher/prompt failures.
- [ ] **Step 3: Implement the dispatcher lock, normalized result, and safe logging.** Use a closure-scoped `active` boolean, reject concurrent calls with `BUSY`, and release in `finally`. Call Task 1 resolver, then the adapter. Map known error prefixes to the contract's `ErrorCode`, including `ENOENT` to `CLI_NOT_FOUND`, abort to `USER_ABORT`, deadline to `PROCESS_TIMEOUT`, absent final event to `MALFORMED_OUTPUT`, and all other failures to `PROCESS_EXIT_ERROR`; map auth, quota, rate and model failures from bounded CLI events. Return only a short safe message and cap content at 32,000 characters. Log role, resolved runtime/model, duration, and status through `src/logging.ts`, never the task, context, credentials or raw stderr. For write results, list paths currently changed in `git status --porcelain` after the run; mark these as candidates because pre-existing modifications may be present, and require the Supervisor to inspect the diff.

```ts
let active = false;
const knownCodes = new Set<ErrorCode>(["CLI_NOT_FOUND", "AUTH_REQUIRED", "RATE_LIMIT", "QUOTA_EXHAUSTED", "PROCESS_TIMEOUT", "PROCESS_EXIT_ERROR", "MALFORMED_OUTPUT", "MODEL_UNAVAILABLE", "USER_ABORT", "BUSY", "INVALID_REQUEST"]);
function failed(request: DispatchRequest, code: ErrorCode, message: string): DispatchResult {
  return { status: "failed", role: request.role, runtime: request.runtime, model: request.model, permission: request.permission ?? "read", error: { code, message, retryable: code === "RATE_LIMIT" || code === "PROCESS_TIMEOUT" } };
}
function normalizeFailure(request: DispatchRequest, error: unknown): DispatchResult {
  const message = error instanceof Error ? error.message : String(error);
  const prefix = message.split(":", 1)[0] as ErrorCode;
  const code = knownCodes.has(prefix) ? prefix : "PROCESS_EXIT_ERROR";
  return failed(request, code, code === "PROCESS_EXIT_ERROR" ? "Specialist execution failed" : message.slice(0, 240));
}
return async (request, ctx, signal, onProgress) => {
  if (active) return failed(request, "BUSY", "A specialist is already running");
  active = true;
  try {
    const roleModels = Object.fromEntries((["architect", "reviewer", "security-reviewer"] as const).flatMap(role => { const model = ctx.models.resolve(`@${role}`); return model ? [[role, `${model.provider}/${model.id}`]] : []; }));
    const task = resolveTask(request, { currentModel: ctx.models.current() ? `${ctx.models.current()!.provider}/${ctx.models.current()!.id}` : undefined, roleModels, hasModel: id => Boolean(ctx.models.resolve(id)), cwd: ctx.cwd });
    return await adapters[task.runtime].run(task, signal, onProgress);
  } catch (error) { return normalizeFailure(request, error); }
  finally { active = false; }
};
```

```ts
// src/logging.ts: call only with metadata; never pass request.task or context.
export function logLifecycle(event: { phase: "start" | "end"; role: string; runtime: string; model?: string; status?: string; durationMs?: number }): void {
  process.stderr.write(`[ORC] ${JSON.stringify(event)}\n`);
}
```

- [ ] **Step 4: Register `orc_dispatch` and inject Supervisor guidance.** Use `pi.registerTool` with an enum schema for role/runtime/complexity/permission; pass the OMP `signal` and `onUpdate` to dispatcher. Add `pi.on("before_agent_start", ...)` that appends, not replaces, the current system prompt. Guidance says delegate only when useful, honor user runtime/model directions and active skills, verify advisory findings, and retain final ownership.

```ts
export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", event => ({ systemPrompt: [...(Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt]), supervisorPrompt] }));
  pi.registerTool({ name: "orc_dispatch", label: "ORC specialist", description: "Run one specialist task through an OMP model, Claude CLI, or Codex CLI", parameters: pi.zod.object({ task: pi.zod.string(), role: pi.zod.enum(["architect", "reviewer", "security-reviewer"]), runtime: pi.zod.enum(["auto", "omp-model", "claude-cli", "codex-cli"]), model: pi.zod.string().optional(), complexity: pi.zod.enum(["trivial", "normal", "hard", "critical"]).optional(), permission: pi.zod.enum(["read", "write"]).optional(), context: pi.zod.string().optional() }), async execute(_id, params, signal, onUpdate, ctx) { const result = await dispatcher(params, ctx, signal, text => onUpdate?.({ content: [{ type: "text", text }] })); return { content: [{ type: "text", text: JSON.stringify(result) }], details: result }; } });
}
```

- [ ] **Step 5: Document installation and live smoke in `README.md`.** Use `npm install`, `npm test`, `npm run typecheck`, and `omp --plugin-dir .` from this repository. Give three prompts: request an architecture opinion via Claude CLI; request correctness review via Codex CLI; explicitly request security review with a configured DeepSeek provider/model through `omp-model`. Include Ctrl+C and read-only marker-file probes. State that CI uses fakes and the local smoke requires users' own authenticated CLIs/providers.
- [ ] **Step 6: Run `npm test`, `npm run typecheck`, `git diff --check`, and the local OMP smoke procedure.** Expected: all tests pass, no whitespace errors, model choice and cancellation are visible in the same terminal, no read-only marker appears, and no child remains after abort.
- [ ] **Step 7: Commit.** `git add src/dispatch.ts src/index.ts src/supervisor-prompt.ts src/logging.ts tests/dispatch.test.ts tests/extension.test.ts README.md` then `git commit -m "feat: expose ORC dispatch in OMP"`.

## Final branch verification

- [ ] Run the full test and typecheck commands once after all tasks.
- [ ] Inspect the diff against this plan and the approved spec for missing acceptance criteria.
- [ ] Check logs and test fixtures for raw credentials or full secret-bearing prompts.
- [ ] Run one end-to-end OMP session using a non-default main model and a user-selected specialist runtime.
- [ ] Obtain one whole-branch review before integration, validate every finding, and rerun affected checks after fixes.
