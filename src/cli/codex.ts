import type { DispatchResult, RuntimeAdapter } from "../contracts.ts";
import { runJsonLines } from "../process.ts";
import { buildSpecialistPrompt } from "../roles.ts";
import { classifyCliError } from "./errors.ts";

type Runner = typeof runJsonLines;

export function createCodexAdapter(run: Runner = runJsonLines): RuntimeAdapter {
  return {
    async run(task, signal, onProgress): Promise<DispatchResult> {
      const args = ["exec", "--json", "--ephemeral", "--sandbox", task.permission === "read" ? "read-only" : "workspace-write", "-C", task.cwd];
      if (task.model) args.push("-m", task.model);
      if (task.effort) args.push("-c", `model_reasoning_effort=${task.effort}`);
      const output = await run("codex", args, {
        cwd: task.cwd,
        stdin: buildSpecialistPrompt(task),
        signal,
        timeoutMs: 300_000,
        maxBytes: 2_000_000,
        onProgress,
      }).catch(error => { throw classifyCliError(error); });
      if (output.lines.some((line: any) => line?.type === "turn.failed")) {
        throw new Error("PROCESS_EXIT_ERROR: Codex turn failed");
      }
      const complete = output.lines.some((line: any) => line?.type === "turn.completed");
      const final = output.lines.findLast((line: any) => line?.type === "item.completed" && line.item?.type === "agent_message") as { item?: { text?: unknown } } | undefined;
      if (!complete || typeof final?.item?.text !== "string") {
        throw new Error("MALFORMED_OUTPUT: Codex final message missing");
      }
      return { status: "completed", role: task.role, runtime: task.runtime, model: task.model, permission: task.permission, content: final.item.text };
    },
  };
}
