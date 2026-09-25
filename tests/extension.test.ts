import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../src/index.ts";

test("extension registers one specialist tool and appends Supervisor guidance", () => {
  const hooks: Record<string, (event: any) => any> = {};
  const tools: Array<{ name: string; execute: Function }> = [];
  const schema = { optional() { return this; } };
  const zod = { string: () => schema, enum: () => schema, object: () => schema };
  extension({ on: (name: string, handler: (event: any) => any) => { hooks[name] = handler; }, registerTool: (tool: any) => { tools.push(tool); }, zod } as any);
  assert.deepEqual(tools.map(tool => tool.name), ["orc_dispatch"]);
  const response = hooks.before_agent_start({ systemPrompt: ["existing user and skill instructions"] });
  assert.equal(response.systemPrompt[0], "existing user and skill instructions");
  assert.match(response.systemPrompt.at(-1), /user.*runtime|runtime.*user/i);
  assert.match(response.systemPrompt.at(-1), /skill.*approval/i);
  assert.match(response.systemPrompt.at(-1), /verify.*finding/i);
});
