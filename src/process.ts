import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export interface ProcessOptions {
  cwd: string;
  stdin: string;
  signal: AbortSignal;
  timeoutMs: number;
  maxBytes: number;
  onProgress(text: string): void;
}

export interface ProcessOutput {
  lines: unknown[];
  stderr: string;
  exitCode: number;
}

export class ProcessExitError extends Error {
  constructor(message: string, readonly lines: unknown[], readonly stderr: string, readonly exitCode: number) {
    super(message);
  }
}

export async function runJsonLines(binary: string, args: string[], options: ProcessOptions): Promise<ProcessOutput> {
  if (options.signal.aborted) throw new Error("USER_ABORT: task canceled");

  const child = spawn(binary, args, { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"] });
  const lines: unknown[] = [];
  let stderr = "";
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let failure: Error | undefined;
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;

  const stop = (error: Error) => {
    if (failure) return;
    failure = error;
    child.kill("SIGTERM");
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
  };
  const abort = () => stop(new Error("USER_ABORT: task canceled"));
  options.signal.addEventListener("abort", abort, { once: true });
  deadline = setTimeout(() => stop(new Error("PROCESS_TIMEOUT: task exceeded time limit")), options.timeoutMs);

  child.stdin.on("error", () => {});
  child.stdin.end(options.stdin);
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > options.maxBytes) stop(new Error("MALFORMED_OUTPUT: stdout exceeded limit"));
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length;
    if (stderrBytes > options.maxBytes) {
      stop(new Error("MALFORMED_OUTPUT: stderr exceeded limit"));
    } else {
      stderr += chunk.toString("utf8");
    }
  });

  const reader = createInterface({ input: child.stdout });
  reader.on("line", line => {
    if (failure || !line.trim()) return;
    try {
      const event: unknown = JSON.parse(line);
      lines.push(event);
      if (event && typeof event === "object" && "type" in event && typeof event.type === "string") {
        options.onProgress(event.type);
      }
    } catch {
      stop(new Error("MALFORMED_OUTPUT: invalid JSON line"));
    }
  });

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      child.once("error", error => reject(error));
      child.once("close", code => resolve(code ?? -1));
    });
    if (failure) throw failure;
    if (exitCode !== 0) throw new ProcessExitError(`PROCESS_EXIT_ERROR: CLI exited with code ${exitCode}`, lines, stderr, exitCode);
    return { lines, stderr, exitCode };
  } catch (error) {
    if (failure) throw failure;
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error("CLI_NOT_FOUND: executable is not installed");
    }
    throw error;
  } finally {
    reader.close();
    options.signal.removeEventListener("abort", abort);
    if (deadline) clearTimeout(deadline);
    if (forceTimer) clearTimeout(forceTimer);
  }
}
