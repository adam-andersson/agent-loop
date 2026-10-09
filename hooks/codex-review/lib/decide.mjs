const PREFIX = { plan: "P", code: "C" };
const CLOSING_STATUSES = new Set(["resolved", "withdrawn"]);
const DISPOSITIONS = new Set(["accepted", "rejected", "needs-human"]);

export function decideRound({ phase, findings, nextId, rounds, cap, review, dispositions }) {
  const updated = structuredClone(findings);
  const reasons = [];
  const resolutionFor = new Map(review.resolutions.map((resolution) => [resolution.id, resolution]));

  for (const carried of Object.values(updated)) {
    if (carried.phase !== phase || carried.status !== "open") continue;
    const resolution = resolutionFor.get(carried.id);
    if (resolution && CLOSING_STATUSES.has(resolution.status)) {
      carried.status = resolution.status;
      carried.resolution = resolution;
      continue;
    }
    const disposition = dispositions[carried.id]?.disposition;
    if (disposition === "rejected" && resolution?.status === "still-open") {
      reasons.push(`${carried.id}: Codex keeps it open after Opus rejected it with evidence`);
    }
    if (disposition === "needs-human") {
      reasons.push(`${carried.id}: marked needs-human`);
    }
  }

  let id = nextId;
  for (const raised of review.findings) {
    const assigned = `${PREFIX[phase]}${id++}`;
    updated[assigned] = { ...raised, id: assigned, phase, status: "open" };
  }

  const openBlocking = Object.values(updated).filter(
    (entry) => entry.phase === phase && entry.status === "open" && entry.severity === "blocking"
  );
  const roundsAfter = rounds + 1;
  if (reasons.length === 0 && openBlocking.length > 0 && roundsAfter >= cap) {
    reasons.push(`round cap of ${cap} reached with ${openBlocking.length} blocking finding(s) open`);
  }

  let outcome = "block";
  if (reasons.length > 0) outcome = "escalate";
  else if (openBlocking.length === 0) outcome = "pass";

  return { outcome, findings: updated, nextId: id, rounds: roundsAfter, reasons, openBlocking };
}

export function parseDispositions(text, knownIds) {
  if (text === undefined) return { dispositions: {}, ignored: [] };
  let entries;
  try {
    entries = JSON.parse(text);
  } catch {
    return { dispositions: {}, ignored: ["dispositions.json is not valid JSON; all dispositions ignored"] };
  }
  if (!Array.isArray(entries)) {
    return { dispositions: {}, ignored: ["dispositions.json must be a JSON array; all dispositions ignored"] };
  }
  const known = new Set(knownIds);
  const dispositions = {};
  const ignored = [];
  for (const entry of entries) {
    if (!known.has(entry?.id)) {
      ignored.push(`unknown finding id ${JSON.stringify(entry?.id)} ignored`);
    } else if (!DISPOSITIONS.has(entry.disposition) || typeof entry.evidence !== "string") {
      ignored.push(`${entry.id}: disposition must be accepted, rejected or needs-human with evidence; ignored`);
    } else {
      dispositions[entry.id] = entry;
    }
  }
  return { dispositions, ignored };
}
