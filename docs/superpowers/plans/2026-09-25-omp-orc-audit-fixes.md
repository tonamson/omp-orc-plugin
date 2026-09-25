# OMP ORC Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this consolidated review fix pass. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all four confirmed review findings before V1 is considered ready.

**Architecture:** Keep the approved ORC dispatch design. Repair cancellation and terminal-result handling at their runtime boundaries, then correct changed-path reporting. Write every regression test first, observe it fail, apply one focused fix, and run the full suite after each fix.

**Tech Stack:** TypeScript, Node.js `node:test`, OMP SDK 18.3.1.

**Spec:** `docs/superpowers/specs/2026-09-25-omp-orc-dispatch-design.md`

## Global Constraints

- No new runtime, provider, or agent role is added.
- CLI and OMP read-only boundaries remain fail closed.
- Credentials, raw stderr, and full prompts remain absent from logs and normalized errors.
- Authenticated Claude and OMP provider smoke tests remain separate acceptance checks when those accounts are configured.

## Review Focus

1. Abort while a CLI descendant holds stdout/stderr open must stop the owned process group and release dispatch promptly.
2. Abort during OMP SDK loading or session creation must prevent any prompt; any late-created session must be disposed.
3. OMP terminal error or aborted messages must override earlier partial text and produce a normalized failure.
4. A Git rename/copy status record must preserve both complete paths in the write result.

---

### Task 1: Stop the owned CLI process tree

**Files:** Modify `src/process.ts`, `tests/process.test.ts`.

**Interfaces:** Preserve `runJsonLines` and `ProcessOutput`.

- [ ] **Step 1: Write a regression test** that starts a parent spawning a grandchild which writes a marker after three seconds while inheriting stdout/stderr. Abort after the grandchild signals readiness. Assert `USER_ABORT` returns near the two-second grace bound and the marker remains absent after the delayed-write interval.
- [ ] **Step 2: Run `node --import tsx --test tests/process.test.ts`.** Expected: the new test fails because the descendant survives or the return is late.
- [ ] **Step 3: Spawn a dedicated process group on POSIX and signal the group** with `SIGTERM`, then `SIGKILL` after two seconds. Keep a direct-child fallback for platforms without process groups. Ensure completion, abort and timeout clean up listeners and timers.
- [ ] **Step 4: Run the focused test, then `npm test` and `npm run typecheck`.** Expected: all pass.

### Task 2: Cover OMP initialization with cancellation and timeout

**Files:** Modify `src/omp-model.ts`, `tests/omp-model.test.ts`.

**Interfaces:** Preserve `createOmpModelAdapter` and `RuntimeAdapter.run`.

- [ ] **Step 1: Write regression tests** for abort during SDK loading and during `createAgentSession`. In both cases assert `prompt()` never runs; if a session appears after cancellation, assert it is disposed. Add an initialization timeout case with a deferred SDK promise.
- [ ] **Step 2: Run `node --import tsx --test tests/omp-model.test.ts`.** Expected: the new tests fail because abort is observed only after session creation.
- [ ] **Step 3: Install the abort/deadline gate before the first await.** Race initialization against it, recheck the signal after each await, dispose a late-created session, and keep the gate active through prompt/idle settlement.
- [ ] **Step 4: Run focused and full tests plus typecheck.** Expected: all pass and no prompt starts after cancellation.

### Task 3: Treat OMP terminal failures as failures

**Files:** Modify `src/omp-model.ts`, `tests/omp-model.test.ts`.

**Interfaces:** Preserve normalized `DispatchResult` and existing error codes.

- [ ] **Step 1: Write regression tests** for partial text followed by `message_end` with `stopReason: "error"`, `message_end` with `stopReason: "aborted"`, and a no-text authentication failure. Assert `RATE_LIMIT`, `USER_ABORT`, and `AUTH_REQUIRED` respectively.
- [ ] **Step 2: Run focused tests.** Expected: the new tests fail by returning partial success or `MALFORMED_OUTPUT`.
- [ ] **Step 3: Inspect the terminal assistant message and classify failure before success.** Return success only after a non-error final assistant outcome; keep partial text advisory and bounded.
- [ ] **Step 4: Run focused and full tests plus typecheck.** Expected: all pass.

### Task 4: Parse Git changed paths correctly

**Files:** Modify `src/dispatch.ts`, `tests/dispatch.test.ts`.

**Interfaces:** Keep `changedPaths` as candidate paths, including pre-existing changes.

- [ ] **Step 1: Write a regression test** in a disposable Git repo that stages or records a file, renames it, dispatches a write task, and asserts the result includes the complete old and new names.
- [ ] **Step 2: Run `node --import tsx --test tests/dispatch.test.ts`.** Expected: the old name is truncated by `slice(3)`.
- [ ] **Step 3: Parse porcelain `-z` records by status.** Consume the extra source-path record for rename/copy entries without stripping a status prefix from it. Deduplicate the candidate path list.
- [ ] **Step 4: Run focused and full tests plus typecheck, inspect `git diff --check`, and commit the combined fixes.** Expected: all pass.

## Final verification

- [ ] Check the four original reproductions against the fixed code.
- [ ] Run `npm test`, `npm run typecheck`, and `git diff --check` once more.
- [ ] Review credential and provider-dependent smoke gaps separately; do not claim they passed without configured accounts.
