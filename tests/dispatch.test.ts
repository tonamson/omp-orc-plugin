import assert from "node:assert/strict";
import { test } from "node:test";
import type { DispatchRequest, RuntimeAdapter } from "../src/contracts.ts";
import { createDispatcher } from "../src/dispatch.ts";

const request: DispatchRequest = { task: "Review this diff", role: "reviewer", runtime: "codex-cli" };
const context = { cwd: process.cwd() };
const environment = () => ({ currentModel: "openai/gpt-5.4", roleModels: {}, hasModel: (id: string) => id === "deepseek/deepseek-v4", cwd: context.cwd });

test("second dispatch returns BUSY and lock releases after first finishes", async () => {
  let finishFirst!: () => void;
  let runs = 0;
  const adapter: RuntimeAdapter = {
    run: task => new Promise(resolve => {
      const done = () => resolve({ status: "completed", role: task.role, runtime: task.runtime, permission: task.permission, content: "done" });
      if (++runs === 1) finishFirst = done;
      else done();
    }),
  };
  const dispatch = createDispatcher(() => adapter, environment, () => {});
  const first = dispatch(request, context, new AbortController().signal, () => {});
  const second = await dispatch(request, context, new AbortController().signal, () => {});
  assert.equal(second.error?.code, "BUSY");
  finishFirst();
  await first;
  assert.equal((await dispatch(request, context, new AbortController().signal, () => {})).status, "completed");
});

test("explicit provider model is passed to selected adapter", async () => {
  let seen = "";
  const adapter: RuntimeAdapter = { async run(task) {
    seen = `${task.runtime}:${task.model}:${task.permission}`;
    return { status: "completed", role: task.role, runtime: task.runtime, model: task.model, permission: task.permission, content: "reviewed" };
  } };
  const dispatch = createDispatcher(() => adapter, environment, () => {});
  const result = await dispatch({ task: "Audit", role: "security-reviewer", runtime: "omp-model", model: "deepseek/deepseek-v4" }, context, new AbortController().signal, () => {});
  assert.equal(seen, "omp-model:deepseek/deepseek-v4:read");
  assert.equal(result.status, "completed");
});

test("adapter failure returns safe code and releases lock", async () => {
  let runs = 0;
  const adapter: RuntimeAdapter = { async run(task) {
    if (++runs === 1) throw new Error("AUTH_REQUIRED: secret-token-123");
    return { status: "completed", role: task.role, runtime: task.runtime, permission: task.permission, content: "ok" };
  } };
  const logs: string[] = [];
  const dispatch = createDispatcher(() => adapter, environment, event => logs.push(JSON.stringify(event)));
  const first = await dispatch({ ...request, task: "secret-token-123" }, context, new AbortController().signal, () => {});
  assert.equal(first.error?.code, "AUTH_REQUIRED");
  assert.equal(JSON.stringify(first).includes("secret-token-123"), false);
  assert.equal(logs.join(" ").includes("secret-token-123"), false);
  assert.equal((await dispatch(request, context, new AbortController().signal, () => {})).status, "completed");
});

test("content is bounded before returning to Supervisor", async () => {
  const adapter: RuntimeAdapter = { async run(task) { return { status: "completed", role: task.role, runtime: task.runtime, permission: task.permission, content: "x".repeat(40_000) }; } };
  const dispatch = createDispatcher(() => adapter, environment, () => {});
  const result = await dispatch(request, context, new AbortController().signal, () => {});
  assert.ok((result.content?.length ?? 0) <= 32_000);
});

test("write permission stays explicit", async () => {
  const adapter: RuntimeAdapter = { async run(task) { return { status: "completed", role: task.role, runtime: task.runtime, permission: task.permission, content: "done" }; } };
  const dispatch = createDispatcher(() => adapter, environment, () => {});
  assert.equal((await dispatch(request, context, new AbortController().signal, () => {})).permission, "read");
  assert.equal((await dispatch({ ...request, permission: "write" }, context, new AbortController().signal, () => {})).permission, "write");
});
