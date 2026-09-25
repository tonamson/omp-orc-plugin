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

export function createOmpModelAdapter(ctx: OmpContext, sdkLoader: SdkLoader = loadSdk, timeoutMs = 300_000): RuntimeAdapter {
  return {
    async run(task, signal, onProgress): Promise<DispatchResult> {
      if (task.permission === "write") {
        throw new Error("INVALID_REQUEST: OMP model write isolation is unavailable");
      }
      const selected = task.model ? ctx.models.resolve(task.model) : ctx.models.current();
      if (!selected) throw new Error("MODEL_UNAVAILABLE: selected OMP model is unavailable");
      if (signal.aborted) throw new Error("USER_ABORT: task canceled");

      let session: SessionLike | undefined;
      let disposedLateSession: SessionLike | undefined;
      let unsubscribe: (() => void) | undefined;
      let content = "";
      let terminalError: Error | undefined;
      let rejectCancellation!: (error: Error) => void;
      const cancellation = new Promise<never>((_, reject) => { rejectCancellation = reject; });
      let cancellationError: Error | undefined;
      const cancel = (error: Error) => {
        if (cancellationError) return;
        cancellationError = error;
        if (session) void Promise.resolve(session.abort()).catch(() => {}).finally(() => rejectCancellation(error));
        else rejectCancellation(error);
      };
      const abort = () => cancel(new Error("USER_ABORT: task canceled"));
      signal.addEventListener("abort", abort, { once: true });
      const deadline = setTimeout(() => cancel(new Error("PROCESS_TIMEOUT: task exceeded time limit")), timeoutMs);
      try {
        const sdk = await Promise.race([sdkLoader(), cancellation]);
        if (cancellationError) throw cancellationError;
        const creation = sdk.createAgentSession({
          cwd: task.cwd,
          model: selected,
          modelRegistry: ctx.modelRegistry,
          authStorage: ctx.modelRegistry.authStorage,
          sessionManager: sdk.SessionManager.inMemory(),
          toolNames: ["read", "grep", "glob"],
          restrictToolNames: true,
        });
        void creation.then(({ session: lateSession }) => {
          if (cancellationError && session !== lateSession) {
            disposedLateSession = lateSession;
            void lateSession.dispose().catch(() => {});
          }
        }, () => {});
        const created = await Promise.race([creation, cancellation]);
        session = created.session;
        if (cancellationError) throw cancellationError;
        unsubscribe = session.subscribe(event => {
          if (event?.type === "message_end" && event.message?.role === "assistant") {
            const reason = event.message.stopReason;
            if (reason === "aborted") terminalError = new Error("USER_ABORT: OMP specialist aborted");
            else if (reason === "error") {
              const detail = String(event.message.errorMessage ?? "").toLowerCase();
              const code = /rate.limit|too many requests/.test(detail) ? "RATE_LIMIT"
                : /quota.exhausted|quota exceeded|insufficient.quota/.test(detail) ? "QUOTA_EXHAUSTED"
                : /authentication|unauthorized|login required|not logged in/.test(detail) ? "AUTH_REQUIRED"
                : /model.not.found|model.unavailable/.test(detail) ? "MODEL_UNAVAILABLE"
                : "PROCESS_EXIT_ERROR";
              terminalError = new Error(`${code}: OMP specialist failed`);
            }
          }
          if (event?.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
            const delta = event.assistantMessageEvent.delta;
            if (typeof delta === "string") {
              content += delta;
              onProgress(delta);
            }
          }
        });
        const activeSession = session;
        await Promise.race([activeSession.prompt(buildSpecialistPrompt(task)).then(() => activeSession.waitForIdle()), cancellation]);
        if (cancellationError) throw cancellationError;
        if (terminalError) throw terminalError;
        if (!content.trim()) throw new Error("MALFORMED_OUTPUT: OMP specialist returned no text");
        return { status: "completed", role: task.role, runtime: "omp-model", model: `${selected.provider}/${selected.id}`, permission: task.permission, content };
      } finally {
        clearTimeout(deadline);
        signal.removeEventListener("abort", abort);
        unsubscribe?.();
        if (session && session !== disposedLateSession) await session.dispose();
      }
    },
  };
}
