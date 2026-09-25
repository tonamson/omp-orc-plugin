import type { ResolvedTask } from "./contracts.ts";

const roleInstruction = {
  architect: "Analyze architecture, tradeoffs, risks, and a concrete plan.",
  reviewer: "Review correctness, regressions, edge cases, and maintainability. Cite file and line for findings.",
  "security-reviewer": "Perform a security audit of trust boundaries, auth, injection, secrets, and data safety. Give severity, file, line, evidence, and remediation.",
} as const;

export function buildSpecialistPrompt(task: ResolvedTask): string {
  return `${roleInstruction[task.role]}\nYour result is advisory; the OMP Supervisor verifies it and owns the final task.\nPermission: ${task.permission}.\nTask: ${task.task}\nContext: ${task.context ?? "None supplied"}`;
}
