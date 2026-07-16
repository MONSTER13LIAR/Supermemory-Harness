import { appendExplanation, explainHarnessResult } from "./local-brain.js";

const STATUS_ICON = {
  ready: "OK",
  planned: "PLAN",
  attention: "!",
  block: "BLOCK",
  warn: "WARN",
  pass: "PASS",
  fail: "FAIL",
  active: "LIVE",
  idle: "IDLE"
};

export async function attachSmartSections(result, options = {}) {
  const smartSections = buildSmartSections(result);
  result.smartSections = smartSections;
  result.text = appendSmartSections(result.text, smartSections);

  if (options.explain) {
    result.explanation = await explainHarnessResult({ ...result, sections: smartSections }, {
      fetch: options.fetch,
      ollamaModel: options.ollamaModel
    });
    result.text = appendExplanation(result.text, result.explanation);
  }

  return result;
}

export function buildSmartSections(result) {
  const sections = [];
  addDecisionSection(sections, result);
  addScoreSection(sections, result);
  addActionSection(sections, result);
  addDreamSection(sections, result);
  addIssueSection(sections, result);
  addNextSection(sections, result);
  return uniqueSections(sections).slice(0, 5);
}

export function appendSmartSections(text, sections) {
  if (!sections?.length) return text;
  const lines = [text.trimEnd(), "", "Smart Sections:"];
  for (const section of sections) {
    lines.push(`${STATUS_ICON[section.status] ?? "INFO"} ${section.title}`);
    lines.push(`   ${section.detail}`);
    if (section.next) lines.push(`   Next: ${section.next}`);
  }
  return lines.join("\n");
}

function addDecisionSection(sections, result) {
  if (!result.decision) return;
  sections.push({
    id: "decision",
    title: "Decision gate",
    status: result.decision.status,
    detail: `${result.decision.label}: ${result.decision.detail}`,
    next: normalizeNext(result.next)
  });
}

function addScoreSection(sections, result) {
  if (!result.score) return;
  const value = Number(result.score.value);
  sections.push({
    id: "score",
    title: "Memory confidence",
    status: Number.isFinite(value) && value < 40 ? "attention" : "pass",
    detail: `${result.score.value}/100 (${result.score.label}) - ${result.score.detail}`,
    next: normalizeNext(result.next)
  });
}

function addActionSection(sections, result) {
  if (!Array.isArray(result.actions) || result.actions.length === 0) return;
  const needs = result.actions.filter((action) => action.status === "needs-attention");
  const planned = result.actions.filter((action) => action.status === "planned");
  const ready = result.actions.filter((action) => action.status === "ready");
  const focus = needs[0] ?? planned[0] ?? ready[0];
  sections.push({
    id: "activation",
    title: "Automatic activation",
    status: needs.length > 0 ? "attention" : planned.length > 0 ? "planned" : "ready",
    detail: `${ready.length} ready, ${planned.length} planned, ${needs.length} need attention. Focus: ${focus.title}.`,
    next: normalizeNext(result.next)
  });
}

function addDreamSection(sections, result) {
  if (!result.diff || !result.state) return;
  const failed = result.diff.failed?.length ?? 0;
  const completed = result.diff.completed?.length ?? 0;
  const disappeared = result.diff.disappeared?.length ?? 0;
  const status = failed > 0 ? "attention" : result.state.label === "active" ? "active" : "idle";
  sections.push({
    id: "dreams",
    title: "Dream processing",
    status,
    detail: `${result.state.label}: ${completed} completed, ${failed} failed, ${disappeared} disappeared since the last snapshot.`,
    next: normalizeNext(result.next)
  });
}

function addIssueSection(sections, result) {
  const issues = [
    ...(Array.isArray(result.blockers) ? result.blockers : []),
    ...(Array.isArray(result.warnings) ? result.warnings : []),
    ...(Array.isArray(result.issues) ? result.issues : [])
  ];
  const serious = issues.filter((issue) => ["fail", "warn"].includes(issue.status));
  if (serious.length === 0) return;
  const first = serious[0];
  sections.push({
    id: "risks",
    title: first.status === "fail" ? "Blocking memory risk" : "Memory warnings",
    status: first.status === "fail" ? "fail" : "warn",
    detail: `${serious.length} issue(s). First: ${first.title}${first.detail ? ` - ${first.detail}` : ""}`,
    next: normalizeNext(result.next)
  });
}

function addNextSection(sections, result) {
  const next = normalizeNext(result.next);
  if (!next) return;
  sections.push({
    id: "next",
    title: "Next command",
    status: result.exitCode === 0 ? "ready" : "attention",
    detail: "The next safest action is already selected from the current Supermemory state.",
    next
  });
}

function uniqueSections(sections) {
  const seen = new Set();
  const unique = [];
  for (const section of sections) {
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    unique.push(section);
  }
  return unique;
}

function normalizeNext(next) {
  if (Array.isArray(next)) return next.find(Boolean) ?? null;
  return next || null;
}
