import type { DispatchResult, RuntimeAdapter } from "../contracts.ts";
import { runJsonLines } from "../process.ts";
import { buildSpecialistPrompt } from "../roles.ts";
import { classifyCliError } from "./errors.ts";

type Runner = typeof runJsonLines;

export function createClaudeAdapter(run: Runner = runJsonLines): RuntimeAdapter {
  return {
    async run(task, signal, onProgress): Promise<DispatchResult> {
      const args = task.permission === "read"
        ? ["-p", "--output-format", "stream-json", "--no-session-persistence", "--restricted", "--strict-mcp-config", "--tools", "Read,Grep,Glob"]
        : ["-p", "--output-format", "stream-json", "--no-session-persistence", "--permission-mode", "acceptEdits"];
      args.push("--verbose");
      if (task.model) args.push("--model", task.model);
      if (task.effort) args.push("--effort", task.effort);
      const output = await run("claude", args, {
        cwd: task.cwd,
        stdin: buildSpecialistPrompt(task),
        signal,
        timeoutMs: 300_000,
        maxBytes: 2_000_000,
        onProgress,
      }).catch(error => { throw classifyCliError(error); });
      const final = output.lines.findLast((line: any) => line?.type === "result") as { result?: unknown; is_error?: boolean } | undefined;
      if (!final || typeof final.result !== "string") throw new Error("MALFORMED_OUTPUT: Claude result missing");
      if (final.is_error) throw new Error("PROCESS_EXIT_ERROR: Claude returned an error result");
      return { status: "completed", role: task.role, runtime: task.runtime, model: task.model, permission: task.permission, content: final.result };
    },
  };
}
