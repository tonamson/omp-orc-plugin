import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runJsonLines } from "../src/process.ts";

function options(signal = new AbortController().signal, timeoutMs = 2_000, maxBytes = 4096) {
  return { cwd: process.cwd(), stdin: "task", signal, timeoutMs, maxBytes, onProgress: (_text: string) => {} };
}

test("parses JSONL and forwards stdin", async () => {
  const output = await runJsonLines(process.execPath, ["-e", "process.stdin.setEncoding('utf8'); let s=''; process.stdin.on('data', x => s+=x); process.stdin.on('end', () => process.stdout.write(JSON.stringify({type:'result',result:s})+'\\n'))"], options());
  assert.deepEqual(output.lines, [{ type: "result", result: "task" }]);
  assert.equal(output.exitCode, 0);
});

test("missing executable returns CLI_NOT_FOUND", async () => {
  await assert.rejects(runJsonLines("__orc_missing_binary__", [], options()), /CLI_NOT_FOUND/);
});

test("malformed JSON line fails with MALFORMED_OUTPUT", async () => {
  await assert.rejects(runJsonLines(process.execPath, ["-e", "process.stdout.write('not json\\n')"], options()), /MALFORMED_OUTPUT/);
});

test("excess stdout fails within bounded memory", async () => {
  await assert.rejects(runJsonLines(process.execPath, ["-e", "process.stdout.write('x'.repeat(10000))"], options(undefined, 2_000, 128)), /MALFORMED_OUTPUT/);
});

test("nonzero exit produces PROCESS_EXIT_ERROR", async () => {
  await assert.rejects(runJsonLines(process.execPath, ["-e", "process.stdout.write('{\"type\":\"error\",\"message\":\"auth failed\"}\\n'); process.exit(7)"], options()), error => {
    assert.match(String(error), /PROCESS_EXIT_ERROR/);
    assert.deepEqual((error as { lines?: unknown[] }).lines, [{ type: "error", message: "auth failed" }]);
    return true;
  });
});

test("abort kills child before delayed filesystem side effect", async () => {
  const dir = await mkdtemp(join(tmpdir(), "orc-abort-"));
  const marker = join(dir, "marker");
  try {
    const controller = new AbortController();
    const code = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 300)`;
    const pending = runJsonLines(process.execPath, ["-e", code], options(controller.signal, 2_000));
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(pending, /USER_ABORT/);
    await new Promise(resolve => setTimeout(resolve, 350));
    await assert.rejects(readFile(marker), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("timeout terminates child with PROCESS_TIMEOUT", async () => {
  await assert.rejects(runJsonLines(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], options(undefined, 50)), /PROCESS_TIMEOUT/);
});
