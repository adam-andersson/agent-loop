import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exitPlanMode, planApproved, pluginRoot, revise, setup, stop, type HookResult } from "./helpers.ts";

const registered = JSON.parse(readFileSync(path.join(pluginRoot, "hooks", "hooks.json"), "utf8")).hooks;
const sampleInput: Record<string, object> = { PreToolUse: exitPlanMode(), PostToolUse: planApproved(), Stop: stop() };
// A first-round blocker goes back to Claude only while the default round caps are in place.
const expected: Record<string, (result: HookResult) => void> = {
  PreToolUse: ({ output }) => assert.equal(output.hookSpecificOutput.permissionDecision, "deny"),
  PostToolUse: ({ output }) => assert.deepEqual(output, {}),
  Stop: ({ output }) => assert.equal(output.decision, "block"),
};

test("every hook registered in hooks.json runs from the plugin root on the default options", () => {
  const t = setup();
  t.respondWith(revise(), revise());
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
        expected[event](result);
      }
    }
  }
  assert.equal(t.codexCalls().length, 2);
});
