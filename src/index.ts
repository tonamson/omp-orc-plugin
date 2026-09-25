import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { DispatchRequest } from "./contracts.ts";
import { createClaudeAdapter } from "./cli/claude.ts";
import { createCodexAdapter } from "./cli/codex.ts";
import { createDispatcher } from "./dispatch.ts";
import { createOmpModelAdapter } from "./omp-model.ts";
import { supervisorPrompt } from "./supervisor-prompt.ts";

export default function (pi: ExtensionAPI): void {
  const claude = createClaudeAdapter();
  const codex = createCodexAdapter();
  const dispatch = createDispatcher(
    (runtime, ctx: ExtensionContext) => runtime === "claude-cli" ? claude : runtime === "codex-cli" ? codex : createOmpModelAdapter(ctx),
    (ctx: ExtensionContext) => {
      const current = ctx.models.current();
      const roleModels = Object.fromEntries(([
        "architect", "reviewer", "security-reviewer",
      ] as const).flatMap(role => {
        const model = ctx.models.resolve(`@${role}`);
        return model ? [[role, `${model.provider}/${model.id}`]] : [];
      }));
      return {
        currentModel: current ? `${current.provider}/${current.id}` : undefined,
        roleModels,
        hasModel: (id: string) => Boolean(ctx.models.resolve(id)),
        cwd: ctx.cwd,
      };
    },
  );

  pi.on("before_agent_start", event => ({ systemPrompt: [...event.systemPrompt, supervisorPrompt] }));

  const z = pi.zod;
  pi.registerTool({
    name: "orc_dispatch",
    label: "ORC specialist",
    description: "Run one advisory specialist task through an OMP model, Claude CLI, or Codex CLI",
    parameters: z.object({
      task: z.string(),
      role: z.enum(["architect", "reviewer", "security-reviewer"]),
      runtime: z.enum(["auto", "omp-model", "claude-cli", "codex-cli"]),
      model: z.string().optional(),
      complexity: z.enum(["trivial", "normal", "hard", "critical"]).optional(),
      permission: z.enum(["read", "write"]).optional(),
      context: z.string().optional(),
    }),
    async execute(_id, params, signal, onUpdate, ctx) {
      const result = await dispatch(params as DispatchRequest, ctx, signal ?? new AbortController().signal, text => {
        onUpdate?.({ content: [{ type: "text", text }], details: {} });
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}
