import { ProcessExitError } from "../process.ts";

export function classifyCliError(error: unknown): Error {
  if (!(error instanceof ProcessExitError) && !(error instanceof Error && "lines" in error)) {
    return error instanceof Error ? error : new Error("PROCESS_EXIT_ERROR: specialist failed");
  }
  const lines = (error as { lines?: unknown[] }).lines;
  const evidence = JSON.stringify(lines ?? []).toLowerCase();
  if (/authentication_failed|not logged in|login required|unauthorized/.test(evidence)) {
    return new Error("AUTH_REQUIRED: sign in with the official CLI");
  }
  if (/quota.exhausted|quota exceeded|insufficient.quota/.test(evidence)) {
    return new Error("QUOTA_EXHAUSTED: specialist quota exhausted");
  }
  if (/rate.limit|too many requests/.test(evidence)) {
    return new Error("RATE_LIMIT: specialist rate limit reached");
  }
  if (/model.not.found|model.unavailable/.test(evidence)) {
    return new Error("MODEL_UNAVAILABLE: requested model is unavailable");
  }
  return error as Error;
}
