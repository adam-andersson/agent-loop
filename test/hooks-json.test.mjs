import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exitPlanMode, planApproved, pluginRoot, reviewJson, setup, stop } from "./helpers.mjs";

const registered = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks;
const sampleInput = { PreToolUse: exitPlanMode(), PostToolUse: planApproved(), Stop: stop() };

test("every hook registered in hooks.json runs from the plugin root", () => {
  const t = setup();
  t.respondWith(reviewJson(), reviewJson());
  t.commitAll("init");
  const events = Object.keys(registered);
  assert.deepEqual(events.sort(), Object.keys(sampleInput).sort());
  // In event order a plan is reviewed, approved, and its change reviewed at Stop.
  for (const event of ["PreToolUse", "PostToolUse", "Stop"]) {
    if (event === "Stop") t.write("a.txt", "two\n");
    for (const { hooks } of registered[event]) {
      for (const { command } of hooks) {
        const result = t.runRegistered(command, sampleInput[event]);
        assert.equal(result.status, 0, `${command}: ${result.stderr}`);
        assert.equal(result.stderr, "", command);
      }
    }
  }
  assert.equal(t.codexCalls().length, 2);
});
