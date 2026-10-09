#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const stdin = readFileSync(0, "utf8");
const outFile = args[args.indexOf("-o") + 1];
const mode = process.env.FAKE_CODEX_MODE ?? "ok";

if (process.env.FAKE_CODEX_LOG) {
  appendFileSync(process.env.FAKE_CODEX_LOG, `${JSON.stringify({ args, stdin })}\n`);
}

const responses = process.env.FAKE_CODEX_RESPONSES?.split(",") ?? [];
const counterFile = process.env.FAKE_CODEX_COUNTER;
let call = 0;
if (counterFile) {
  try {
    call = Number(readFileSync(counterFile, "utf8"));
  } catch {
    call = 0;
  }
  writeFileSync(counterFile, String(call + 1));
}
const responseFile = responses[Math.min(call, responses.length - 1)] ?? process.env.FAKE_CODEX_RESPONSE;

switch (mode) {
  case "exit-nonzero":
    process.exit(2);
  case "hang":
    setTimeout(() => {}, 60_000);
    break;
  case "empty":
    writeFileSync(outFile, "");
    break;
  case "garbage":
    writeFileSync(outFile, "I could not complete the review.");
    break;
  default:
    writeFileSync(outFile, readFileSync(responseFile, "utf8"));
}
