import { readFileSync } from "node:fs";
import type { Config } from "./types.ts";

type Option = { type: string; default?: string | number };
type Manifest = { userConfig: Record<string, Option> };

const REQUIRED = ["model", "planRounds", "codeRounds", "timeoutSec"] as const;

function readManifest(): Manifest {
  return JSON.parse(readFileSync(new URL("../../.claude-plugin/plugin.json", import.meta.url), "utf8"));
}

// Claude Code exports each userConfig option to hooks as CLAUDE_PLUGIN_OPTION_<KEY>. The defaults
// are read from the manifest, so they have one source whether or not Claude Code exports them.
export function loadConfig(env: NodeJS.ProcessEnv = process.env, manifest: Manifest = readManifest()): Config {
  const values: Record<string, string | number> = {};
  for (const [key, option] of Object.entries(manifest.userConfig)) {
    const raw = env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] || option.default;
    if (raw === undefined || raw === "") continue;
    if (option.type === "number") {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`plugin option ${key} is not a number: ${raw}`);
      values[key] = value;
    } else {
      values[key] = String(raw);
    }
  }
  for (const key of REQUIRED) {
    if (values[key] === undefined) throw new Error(`plugin option ${key} has no value`);
  }
  return values as Config;
}
