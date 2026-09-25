export type Runtime = "auto" | "omp-model" | "claude-cli" | "codex-cli";
export type Permission = "read" | "write";
export type Complexity = "trivial" | "normal" | "hard" | "critical";
export type Role = "architect" | "reviewer" | "security-reviewer";
export type ErrorCode =
  | "CLI_NOT_FOUND"
  | "AUTH_REQUIRED"
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "PROCESS_TIMEOUT"
  | "PROCESS_EXIT_ERROR"
  | "MALFORMED_OUTPUT"
  | "MODEL_UNAVAILABLE"
  | "USER_ABORT"
  | "BUSY"
  | "INVALID_REQUEST";

export interface DispatchRequest {
  task: string;
  role: Role;
  runtime: Runtime;
  model?: string;
  complexity?: Complexity;
  permission?: Permission;
  context?: string;
}

export interface ResolvedTask extends DispatchRequest {
  runtime: Exclude<Runtime, "auto">;
  permission: Permission;
  complexity: Complexity;
  effort?: string;
  cwd: string;
}

export interface DispatchError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

export interface DispatchResult {
  status: "completed" | "failed";
  role: Role;
  runtime: Runtime;
  model?: string;
  permission: Permission;
  content?: string;
  changedPaths?: string[];
  error?: DispatchError;
}

export type Progress = (text: string) => void;
export interface RuntimeAdapter {
  run(task: ResolvedTask, signal: AbortSignal, onProgress: Progress): Promise<DispatchResult>;
}
