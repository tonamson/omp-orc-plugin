import type { DispatchResult, RuntimeAdapter } from "./contracts.ts";
import { buildSpecialistPrompt } from "./roles.ts";

interface ModelLike { provider: string; id: string }
interface OmpContext {
  cwd: string;
  models: { current(): ModelLike | undefined; resolve(id: string): ModelLike | undefined };
  modelRegistry: { authStorage: unknown };
}
interface SessionLike {
  subscribe(callback: (event: any) => void): () => void;
  prompt(text: string): Promise<unknown>;
  waitForIdle(): Promise<unknown>;
  abort(): Promise<unknown>;
  dispose(): Promise<unknown>;
}
interface SdkLike {
  SessionManager: { inMemory(): unknown };
  createAgentSession(options: Record<string, unknown>): Promise<{ session: SessionLike }>;
}

type SdkLoader = () => Promise<SdkLike>;
const loadSdk: SdkLoader = async () => {
  const sdk = await import("@oh-my-pi/pi-coding-agent");
  return sdk as unknown as SdkLike;
};

export function createOmpModelAdapter(ctx: OmpContext, sdkLoader: SdkLoader = loadSdk): RuntimeAdapter {
  return {
    async run(task, signal, onProgress): Promise<DispatchResult> {
      if (task.permission === "write") {
        throw new Error("INVALID_REQUEST: OMP model write isolation is unavailable");
      }
      const selected = task.model ? ctx.models.resolve(task.model) : ctx.models.current();
      if (!selected) throw new Error("MODEL_UNAVAILABLE: selected OMP model is unavailable");
      if (signal.aborted) throw new Error("USER_ABORT: task canceled");

      const sdk = await sdkLoader();
      const { session } = await sdk.createAgentSession({
        cwd: task.cwd,
        model: selected,
        modelRegistry: ctx.modelRegistry,
        authStorage: ctx.modelRegistry.authStorage,
        sessionManager: sdk.SessionManager.inMemory(),
        toolNames: ["read", "grep", "glob"],
        restrictToolNames: true,
      });
      let content = "";
      const unsubscribe = session.subscribe(event => {
        if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
          const delta = event.assistantMessageEvent.delta;
          if (typeof delta === "string") {
            content += delta;
            onProgress(delta);
          }
        }
      });

      let rejectCancellation!: (error: Error) => void;
      const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
      const abort = () => {
        void session.abort().finally(() => rejectCancellation(new Error("USER_ABORT: task canceled")));
      };
      signal.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(() => {
        void session.abort().finally(() => rejectCancellation(new Error("PROCESS_TIMEOUT: task exceeded time limit")));
      }, 300_000);
      try {
        await Promise.race([session.prompt(buildSpecialistPrompt(task)).then(() => session.waitForIdle()), cancellation]);
        if (!content.trim()) throw new Error("MALFORMED_OUTPUT: OMP specialist returned no text");
        return { status: "completed", role: task.role, runtime: "omp-model", model: `${selected.provider}/${selected.id}`, permission: task.permission, content };
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener("abort", abort);
        unsubscribe();
        await session.dispose();
      }
    },
  };
}
