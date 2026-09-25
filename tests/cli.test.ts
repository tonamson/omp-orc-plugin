import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedTask } from "../src/contracts.ts";
import { createClaudeAdapter } from "../src/cli/claude.ts";
import { createCodexAdapter } from "../src/cli/codex.ts";

const readTask: ResolvedTask = {
  task: "Review this code; also try to create marker.txt",
  role: "reviewer",
  runtime: "codex-cli",
  permission: "read",
  complexity: "normal",
  effort: "high",
  cwd: process.cwd(),
};

test("Claude read task restricts tools while keeping CLI login", async () => {
  const adapter = createClaudeAdapter(async (binary, args, options) => {
    assert.equal(binary, "claude");
    assert.deepEqual(args.slice(0, 8), ["-p", "--output-format", "stream-json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob"]);
    assert.equal(args.includes("--bare"), false);
    assert.equal(args.includes("--verbose"), true);
    assert.equal(args.includes("acceptEdits"), false);
    assert.match(options.stdin, /Review this code/);
    return { lines: [{ type: "result", result: "reviewed" }], stderr: "", exitCode: 0 };
  });
  const result = await adapter.run({ ...readTask, runtime: "claude-cli" }, new AbortController().signal, () => {});
  assert.equal(result.content, "reviewed");
});

test("Claude explicit write removes read restriction and preserves model", async () => {
  const adapter = createClaudeAdapter(async (_binary, args) => {
    assert.equal(args.includes("--restricted"), false);
    assert.ok(args.includes("acceptEdits"));
    assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "opus"]);
    return { lines: [{ type: "result", result: "changed" }], stderr: "", exitCode: 0 };
  });
  const result = await adapter.run({ ...readTask, runtime: "claude-cli", permission: "write", model: "opus" }, new AbortController().signal, () => {});
  assert.equal(result.permission, "write");
});

test("Codex read task uses read-only sandbox and selected effort", async () => {
  const adapter = createCodexAdapter(async (binary, args, options) => {
    assert.equal(binary, "codex");
    assert.deepEqual(args.slice(0, 6), ["exec", "--json", "--ephemeral", "--sandbox", "read-only", "-C"]);
    assert.ok(args.includes("model_reasoning_effort=high"));
    assert.equal(args.includes("danger-full-access"), false);
    assert.match(options.stdin, /Review this code/);
    return { lines: [{ type: "item.completed", item: { type: "agent_message", text: "safe" } }, { type: "turn.completed" }], stderr: "", exitCode: 0 };
  });
  assert.equal((await adapter.run(readTask, new AbortController().signal, () => {})).content, "safe");
});

test("Codex write task uses workspace sandbox", async () => {
  const adapter = createCodexAdapter(async (_binary, args) => {
    assert.ok(args.includes("workspace-write"));
    return { lines: [{ type: "item.completed", item: { type: "agent_message", text: "done" } }, { type: "turn.completed" }], stderr: "", exitCode: 0 };
  });
  assert.equal((await adapter.run({ ...readTask, permission: "write" }, new AbortController().signal, () => {})).permission, "write");
});

test("Claude missing final result fails instead of returning success", async () => {
  const adapter = createClaudeAdapter(async () => ({ lines: [{ type: "system" }], stderr: "", exitCode: 0 }));
  await assert.rejects(adapter.run({ ...readTask, runtime: "claude-cli" }, new AbortController().signal, () => {}), /MALFORMED_OUTPUT/);
});

test("Codex failed turn fails instead of returning prior agent message", async () => {
  const adapter = createCodexAdapter(async () => ({ lines: [{ type: "item.completed", item: { type: "agent_message", text: "partial" } }, { type: "turn.failed" }], stderr: "", exitCode: 0 }));
  await assert.rejects(adapter.run(readTask, new AbortController().signal, () => {}), /PROCESS_EXIT_ERROR/);
});

test("Claude authentication failure is normalized from process events", async () => {
  const failure = Object.assign(new Error("PROCESS_EXIT_ERROR: CLI exited with code 1"), {
    lines: [{ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Not logged in" }] } }, { type: "result", is_error: true, result: "Not logged in" }],
    stderr: "",
  });
  const adapter = createClaudeAdapter(async () => { throw failure; });
  await assert.rejects(adapter.run({ ...readTask, runtime: "claude-cli" }, new AbortController().signal, () => {}), /AUTH_REQUIRED/);
});

test("Codex rate limit is normalized from process events", async () => {
  const failure = Object.assign(new Error("PROCESS_EXIT_ERROR: CLI exited with code 1"), {
    lines: [{ type: "turn.failed", error: { message: "rate limit exceeded" } }], stderr: "",
  });
  const adapter = createCodexAdapter(async () => { throw failure; });
  await assert.rejects(adapter.run(readTask, new AbortController().signal, () => {}), /RATE_LIMIT/);
});
