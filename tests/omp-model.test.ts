import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedTask } from "../src/contracts.ts";
import { createOmpModelAdapter } from "../src/omp-model.ts";

const readTask: ResolvedTask = { task: "Review this code", role: "reviewer", runtime: "omp-model", permission: "read", complexity: "normal", cwd: process.cwd() };
const selected = { provider: "deepseek", id: "deepseek-v4" };
const context = {
  cwd: process.cwd(),
  models: { current: () => ({ provider: "openai", id: "gpt-5.4" }), resolve: (id: string) => id === "deepseek/deepseek-v4" ? selected : undefined },
  modelRegistry: { authStorage: { credential: "in-memory-only" } },
};

test("explicit provider model receives only read tools and matching auth registry", async () => {
  let options: Record<string, unknown> | undefined;
  let disposed = false;
  const adapter = createOmpModelAdapter(context, async () => ({
    SessionManager: { inMemory: () => ({ kind: "memory" }) },
    createAgentSession: async (input: Record<string, unknown>) => {
      options = input;
      return { session: {
        subscribe(callback: (event: unknown) => void) { callback({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "reviewed" } }); return () => {}; },
        async prompt() {}, async waitForIdle() {}, async abort() {}, async dispose() { disposed = true; },
      } };
    },
  }));
  const result = await adapter.run({ ...readTask, model: "deepseek/deepseek-v4" }, new AbortController().signal, () => {});
  assert.equal(result.content, "reviewed");
  assert.equal((options?.model as { provider: string }).provider, "deepseek");
  assert.deepEqual(options?.toolNames, ["read", "grep", "glob"]);
  assert.equal(options?.restrictToolNames, true);
  assert.equal(options?.modelRegistry, context.modelRegistry);
  assert.equal(options?.authStorage, context.modelRegistry.authStorage);
  assert.deepEqual(options?.sessionManager, { kind: "memory" });
  assert.equal(disposed, true);
});

test("unavailable provider model fails without substituting the main model", async () => {
  const adapter = createOmpModelAdapter(context, async () => { throw new Error("SDK should not load"); });
  await assert.rejects(adapter.run({ ...readTask, model: "missing/model" }, new AbortController().signal, () => {}), /MODEL_UNAVAILABLE/);
});

test("write request fails closed for OMP model until confined write tools exist", async () => {
  const adapter = createOmpModelAdapter(context, async () => { throw new Error("SDK should not load"); });
  await assert.rejects(adapter.run({ ...readTask, permission: "write" }, new AbortController().signal, () => {}), /INVALID_REQUEST/);
});

test("abort reaches child session and disposes it", async () => {
  const controller = new AbortController();
  let aborted = false;
  let disposed = false;
  const adapter = createOmpModelAdapter(context, async () => ({
    SessionManager: { inMemory: () => ({}) },
    createAgentSession: async () => ({ session: {
      subscribe: () => () => {},
      prompt: () => new Promise<void>(() => {}),
      waitForIdle: async () => {},
      abort: async () => { aborted = true; },
      dispose: async () => { disposed = true; },
    } }),
  }));
  const pending = adapter.run({ ...readTask, model: "deepseek/deepseek-v4" }, controller.signal, () => {});
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(pending, /USER_ABORT/);
  assert.equal(aborted, true);
  assert.equal(disposed, true);
});
