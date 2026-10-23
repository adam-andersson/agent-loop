#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync, writeSync } from "node:fs";

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
const responseFile = responses[Math.min(call, responses.length - 1)];

// Codex prints its progress as it works; past 64 MiB on either stream a buffering caller fails.
if (mode === "chatty") {
  const chunk = "x".repeat(1024 * 1024);
  for (let i = 0; i <= 64; i++) {
    writeSync(1, chunk);
    writeSync(2, chunk);
  }
}

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
