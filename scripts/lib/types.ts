export type Config = {
  model: string;
  effort?: string;
  planRounds: number;
  codeRounds: number;
  timeoutSec: number;
};

// The fields of Claude Code's hook input that these hooks read.
export type HookInput = {
  session_id: string;
  cwd: string;
  tool_input?: { plan?: string };
  tool_response?: { plan?: string };
  last_assistant_message?: string;
};

export type Finding = {
  severity: "blocking" | "non-blocking";
  claim: string;
  evidence: string;
  recommendation: string;
};

export type Review = {
  verdict: "approve" | "revise";
  summary: string;
  files_inspected: string[];
  findings: Finding[];
};

export type CodexResult =
  | { status: "reviewed"; review: Review; rawPath: string }
  | { status: "not-reviewed"; reason: string; rawPath: string };

export type PlanState = {
  round: number;
  lastReport: Review | null;
};

export type CodeState = {
  plan: string;
  // Git tree objects: where the section starts, and the tree the last review covered.
  base: string;
  round: number;
  lastTree: string | null;
  lastOutcome: "pass" | "block" | "escalate" | null;
  lastReport: Review | null;
  lastReportPath: string | null;
};

export type LoopState = { plan: PlanState; code: CodeState };
