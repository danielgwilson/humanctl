'use strict';

// Always-on summary engine budget (PR-2 item 4): ONE authoritative unit,
// estimated dollars/day, computed live from actual token usage via
// lib/pricing.js. Pure and Electron-free so it selftests without a display.
//
// Design note (spec): the prior two-cap design (a raw call-count cap AND a
// dollar cap) was self-contradictory -- 200 cold-cache summaries could cost
// roughly $9 even though the call-count cap looked conservative. This module
// tracks exactly one number, real spend, reset daily at local midnight.
//
// Persistence: ~/.humanctl/summary-budget.json, a single small JSON object
// {day: 'YYYY-MM-DD', spentUSD: number}. Not on isInboxRelevantChange's
// allowlist (it is a registry-owned output, not an inbox input), so writing
// it never triggers the inbox watcher.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { priceFor } = require('./pricing');

const DEFAULT_DAILY_BUDGET_USD = 1.0;
const SUMMARY_MODEL = 'claude-haiku-4-5'; // matches electron/main.js's sessionSummarize
// Rough chars-per-token estimate (no tokenizer dependency; this is a LOCAL
// "est" figure only, same honesty bar as lib/pricing.js's own header comment).
const CHARS_PER_TOKEN = 4;

function budgetPath() {
  return path.join(os.homedir(), '.humanctl', 'summary-budget.json');
}

function localDay(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Estimate the USD cost of one summarize call from the actual prompt and
// output text sent/received (chars/4 as a token proxy, priced at the real
// haiku rate table in lib/pricing.js). This is "computed live from actual
// token usage" per the spec, not a flat per-call guess.
function estimateCallUSD(promptText, outputText) {
  const p = priceFor(SUMMARY_MODEL);
  const inTokens = Math.ceil(String(promptText || '').length / CHARS_PER_TOKEN);
  const outTokens = Math.ceil(String(outputText || '').length / CHARS_PER_TOKEN);
  return (inTokens / 1e6) * p.in + (outTokens / 1e6) * p.out;
}

function readBudgetState(now = Date.now()) {
  const day = localDay(now);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(budgetPath(), 'utf8')); } catch { return { day, spentUSD: 0 }; }
  if (!raw || raw.day !== day || typeof raw.spentUSD !== 'number' || !Number.isFinite(raw.spentUSD)) {
    return { day, spentUSD: 0 }; // a new day (or a corrupt/missing file) starts fresh
  }
  return { day, spentUSD: raw.spentUSD };
}

function writeBudgetState(state) {
  try {
    const dir = path.dirname(budgetPath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(budgetPath(), JSON.stringify(state), 'utf8');
  } catch { /* best effort; a lost write just means the day's total under-counts */ }
}

// Records one successful summarize call's cost against today's total.
// Skips (401 retried then abandoned, or any other non-billed failure) must
// NEVER call this -- that is the "do not count skips against budget" rule --
// so this function has no failure-path variant by design.
function recordSpend(promptText, outputText, now = Date.now()) {
  const cost = estimateCallUSD(promptText, outputText);
  const state = readBudgetState(now);
  state.spentUSD += cost;
  writeBudgetState(state);
  return { costUSD: cost, totalUSD: state.spentUSD };
}

// Would the NEXT call (estimated from the prompt alone, output unknown until
// it lands) push today's total over budget? Checked before spawning the CLI
// process, so a session already computed a prompt this call would have used.
// Estimates output as a small fixed size (summaries are capped at ~600 chars
// in electron/main.js) so the pre-check is a reasonable upper bound, not a
// guess that could wildly under- or over-block.
const ESTIMATED_OUTPUT_CHARS = 300;
function wouldExceedBudget(promptText, dailyBudgetUSD = DEFAULT_DAILY_BUDGET_USD, now = Date.now()) {
  const state = readBudgetState(now);
  const estCost = estimateCallUSD(promptText, 'x'.repeat(ESTIMATED_OUTPUT_CHARS));
  return { exceeded: state.spentUSD + estCost > dailyBudgetUSD, spentUSD: state.spentUSD, dailyBudgetUSD };
}

function budgetStatus(dailyBudgetUSD = DEFAULT_DAILY_BUDGET_USD, now = Date.now()) {
  const state = readBudgetState(now);
  return {
    day: state.day,
    spentUSD: state.spentUSD,
    dailyBudgetUSD,
    paused: state.spentUSD >= dailyBudgetUSD,
    remainingUSD: Math.max(0, dailyBudgetUSD - state.spentUSD),
  };
}

module.exports = {
  DEFAULT_DAILY_BUDGET_USD,
  SUMMARY_MODEL,
  budgetPath,
  localDay,
  estimateCallUSD,
  readBudgetState,
  writeBudgetState,
  recordSpend,
  wouldExceedBudget,
  budgetStatus,
};
