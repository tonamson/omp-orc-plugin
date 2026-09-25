export interface LifecycleEvent {
  phase: "start" | "end";
  role: string;
  runtime: string;
  model?: string;
  status?: string;
  durationMs?: number;
}

export function logLifecycle(event: LifecycleEvent): void {
  process.stderr.write(`[ORC] ${JSON.stringify(event)}\n`);
}
