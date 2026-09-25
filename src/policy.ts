import type { DispatchRequest, ResolvedTask, Role } from "./contracts.ts";

export interface RoutingEnvironment {
  currentModel?: string;
  roleModels: Partial<Record<Role, string>>;
  hasModel(id: string): boolean;
  cwd?: string;
}

const defaultRuntime = {
  architect: "claude-cli",
  reviewer: "codex-cli",
  "security-reviewer": "codex-cli",
} as const;

const effort = {
  architect: { normal: "high", hard: "xhigh", critical: "max" },
  reviewer: { normal: "high", hard: "xhigh", critical: "max" },
  "security-reviewer": { normal: "xhigh", hard: "xhigh", critical: "max" },
} as const;

export function resolveTask(request: DispatchRequest, env: RoutingEnvironment): ResolvedTask {
  if (!request.task.trim()) throw new Error("INVALID_REQUEST: task is empty");
  const runtime = request.runtime === "auto" ? defaultRuntime[request.role] : request.runtime;
  const complexity = request.complexity ?? "normal";
  const permission = request.permission ?? "read";
  const model = runtime === "omp-model"
    ? request.model ?? env.roleModels[request.role] ?? env.currentModel
    : request.model;
  if (runtime === "omp-model" && (!model || !env.hasModel(model))) {
    throw new Error("MODEL_UNAVAILABLE: selected model is unavailable");
  }
  if (runtime !== "omp-model" && model?.includes("/")) {
    throw new Error("INVALID_REQUEST: CLI model cannot be an OMP provider/model selector");
  }
  const tier = complexity === "trivial" ? "normal" : complexity;
  return {
    ...request,
    runtime,
    model,
    complexity,
    permission,
    effort: runtime === "omp-model" ? undefined : effort[request.role][tier],
    cwd: env.cwd ?? process.cwd(),
  };
}
