import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveTask } from "../src/policy.ts";
import { buildSpecialistPrompt } from "../src/roles.ts";

const env = { currentModel: "openai/gpt-5.4", roleModels: {}, hasModel: (id: string) => id === "deepseek/deepseek-v4" || id === "openai/gpt-5.4" };

test("explicit OMP model overrides reviewer default and retains read permission", () => {
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
  const prompt = buildSpecialistPrompt(resolveTask({ task: "Audit auth", role: "security-reviewer", runtime: "auto", context: "Changed file: src/auth.ts" }, env));
  assert.match(prompt, /Changed file: src\/auth\.ts/);
  assert.match(prompt, /advisory/i);
  assert.match(prompt, /security/i);
});
