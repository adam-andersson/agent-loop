import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadConfig } from "../scripts/lib/config.ts";

const manifest = JSON.parse(readFileSync(new URL("../.claude-plugin/plugin.json", import.meta.url), "utf8"));

test("with no option set, the config is the manifest's defaults, without an effort", () => {
  assert.deepEqual(loadConfig({}), { model: "gpt-6.1-sol", planRounds: 3, codeRounds: 3, timeoutSec: 1200 });
});

test("a set option overrides its default, and an empty one falls back to it", () => {
  const config = loadConfig({
    CLAUDE_PLUGIN_OPTION_MODEL: "other-model",
    CLAUDE_PLUGIN_OPTION_EFFORT: "high",
    CLAUDE_PLUGIN_OPTION_CODEROUNDS: "5",
    CLAUDE_PLUGIN_OPTION_PLANROUNDS: "",
  });
  assert.deepEqual(config, { model: "other-model", effort: "high", planRounds: 3, codeRounds: 5, timeoutSec: 1200 });
});

test("a number option that is not a number is an error", () => {
  assert.throws(() => loadConfig({ CLAUDE_PLUGIN_OPTION_TIMEOUTSEC: "abc" }), /timeoutSec/);
});

// A missing round cap would compare as NaN and hand every blocker straight to the user.
test("a number option without a value or default is an error", () => {
  const { planRounds, ...userConfig } = manifest.userConfig;
  const withoutDefault = { ...manifest, userConfig: { ...userConfig, planRounds: { ...planRounds, default: undefined } } };
  assert.throws(() => loadConfig({}, withoutDefault), /planRounds/);
});
