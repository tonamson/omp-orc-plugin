import { execFileSync } from "node:child_process";
import type { DispatchRequest, DispatchResult, ErrorCode, Progress, Runtime, RuntimeAdapter } from "./contracts.ts";
import type { RoutingEnvironment } from "./policy.ts";
import { resolveTask } from "./policy.ts";
import { logLifecycle, type LifecycleEvent } from "./logging.ts";

const messages: Record<ErrorCode, string> = {
  CLI_NOT_FOUND: "Specialist CLI is not installed",
  AUTH_REQUIRED: "Sign in with the official specialist CLI",
  RATE_LIMIT: "Specialist rate limit reached",
  QUOTA_EXHAUSTED: "Specialist quota exhausted",
  PROCESS_TIMEOUT: "Specialist task timed out",
  PROCESS_EXIT_ERROR: "Specialist execution failed",
  MALFORMED_OUTPUT: "Specialist returned invalid output",
  MODEL_UNAVAILABLE: "Requested model is unavailable",
  USER_ABORT: "Specialist task canceled",
  BUSY: "A specialist is already running",
  INVALID_REQUEST: "Specialist request is invalid",
};

function failed(request: DispatchRequest, code: ErrorCode, runtime = request.runtime, model = request.model): DispatchResult {
  return {
    status: "failed",
    role: request.role,
    runtime,
    model,
    permission: request.permission ?? "read",
    error: { code, message: messages[code], retryable: code === "RATE_LIMIT" || code === "PROCESS_TIMEOUT" },
  };
}

function errorCode(error: unknown): ErrorCode {
  const raw = error instanceof Error ? error.message : String(error);
  const prefix = raw.split(":", 1)[0];
  if (Object.hasOwn(messages, prefix)) return prefix as ErrorCode;
  if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "CLI_NOT_FOUND";
  return "PROCESS_EXIT_ERROR";
}

function changedPaths(cwd: string): string[] {
  try {
    const status = execFileSync("git", ["status", "--porcelain", "-z"], { cwd, encoding: "utf8", timeout: 5_000 });
    return status.split("\0").filter(Boolean).map(entry => entry.slice(3));
  } catch {
    return [];
  }
}

export function createDispatcher<TContext>(
  adapterFor: (runtime: Exclude<Runtime, "auto">, context: TContext) => RuntimeAdapter,
  environmentFor: (context: TContext) => RoutingEnvironment,
  log: (event: LifecycleEvent) => void = logLifecycle,
) {
  let active = false;
  return async (request: DispatchRequest, context: TContext, signal: AbortSignal, onProgress: Progress): Promise<DispatchResult> => {
    if (active) return failed(request, "BUSY");
    active = true;
    const startedAt = Date.now();
    let resolvedRuntime: Runtime = request.runtime;
    let resolvedModel = request.model;
    try {
      const task = resolveTask(request, environmentFor(context));
      resolvedRuntime = task.runtime;
      resolvedModel = task.model;
      log({ phase: "start", role: task.role, runtime: task.runtime, model: task.model });
      const result = await adapterFor(task.runtime, context).run(task, signal, onProgress);
      if (result.content) result.content = result.content.slice(0, 32_000);
      if (task.permission === "write" && result.status === "completed") result.changedPaths = changedPaths(task.cwd);
      log({ phase: "end", role: task.role, runtime: task.runtime, model: task.model, status: result.status, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const result = failed(request, errorCode(error), resolvedRuntime, resolvedModel);
      log({ phase: "end", role: request.role, runtime: resolvedRuntime, model: resolvedModel, status: result.error?.code, durationMs: Date.now() - startedAt });
      return result;
    } finally {
      active = false;
    }
  };
}
