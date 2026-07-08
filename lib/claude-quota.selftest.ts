// Selftest for lib/claude-quota.ts: the `/usage` parser and the orchestration
// around it. Plain node, zero deps, no network -- and, by construction, ZERO
// process spawns: every case either calls the pure parser directly or drives
// readClaudeQuota() with an injected runner that replays captured stdout. A
// selftest that shelled out to the real `claude` binary would be neither
// hermetic nor safe to run in CI, and would leak real quota numbers.
//
// The fixture strings below mirror the real envelopes byte-for-byte in SHAPE
// (this repo is public: every percentage here is invented, no real account
// numbers appear).
// Run: npm run quota:selftest

import assert from 'assert';
import {
  findClaudeBin,
  isSubscriptionAuth,
  parseClaudeUsage,
  parseUsageWindows,
  readClaudeQuota,
  AUTH_ARGS,
  USAGE_ARGS,
  type RunClaude,
} from './claude-quota';

let passed = 0;
function check(name: string, fn: () => void | Promise<void>): void {
  const fail = (e: unknown) => {
    console.error(`FAIL ${name}`);
    console.error(e && (e as Error).stack ? (e as Error).stack : e);
    process.exitCode = 1;
  };
  try {
    const r = fn();
    if (r && typeof (r as Promise<void>).then === 'function') {
      pending.push((r as Promise<void>).then(() => { passed += 1; }, fail));
      return;
    }
    passed += 1;
  } catch (e) { fail(e); }
}
const pending: Promise<void>[] = [];

const AT = 1_752_000_000_000;

// ---- captured envelope shapes (percentages invented; see header) ----
function envelope(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify(Object.assign({
    type: 'result', subtype: 'success', is_error: false,
    duration_ms: 1975, duration_api_ms: 0, num_turns: 0, total_cost_usd: 0,
    result,
  }, extra));
}

// The happy path: the exact three-window shape a signed-in subscription
// returns, followed by the free-text usage breakdown the parser must ignore.
const HAPPY_RESULT = [
  'You are currently using your subscription to power your Claude Code usage',
  '',
  'Current session: 12% used · resets Jul 8 at 4:50am (America/Los_Angeles)',
  'Current week (all models): 34% used · resets Jul 13 at 2am (America/Los_Angeles)',
  'Current week (Opus): 56% used · resets Jul 13 at 2am (America/Los_Angeles)',
  '',
  "What's contributing to your limits usage?",
  'Approximate, based on local sessions on this machine.',
  '',
  'Last 24h · 8034 requests · 19 sessions',
  '  91% of your usage came from subagent-heavy sessions',
  '  78% of your usage was at >150k context',
  '  Top skills: /alpha 2%, /beta 2%, /gamma 1%',
  '  Top subagents: general-purpose 12%, reviewer 6%',
].join('\n');

// `--bare` strips OAuth and returns only a cost summary: no quota anywhere.
// Note `Total cost:` and `Usage:` are colon-led lines that must NOT match.
const BARE_RESULT = [
  'Total cost:            $0.0000',
  'Total duration (API):  0s',
  'Total duration (wall): 0s',
  'Total code changes:    0 lines added, 0 lines removed',
  'Usage:                 0 input, 0 output, 0 cache read, 0 cache write',
].join('\n');

// Logged out / API-key / Bedrock / Vertex: the command answers, with prose and
// no `% used` line in it.
const NO_SUBSCRIPTION_RESULT = [
  'You are currently using an API key to power your Claude Code usage',
  '',
  'Subscription usage limits do not apply to API key usage.',
].join('\n');

// ---- the parser ----

check('happy path: three windows, verbatim reset text, no epoch invented', () => {
  const q = parseClaudeUsage(envelope(HAPPY_RESULT), AT);
  assert.ok(q, 'expected a quota');
  assert.strictEqual(q.at, AT);
  assert.deepStrictEqual(q.windows, [
    { label: 'Current session', used_percent: 12, resets_at_text: 'Jul 8 at 4:50am (America/Los_Angeles)' },
    { label: 'Current week (all models)', used_percent: 34, resets_at_text: 'Jul 13 at 2am (America/Los_Angeles)' },
    { label: 'Current week (Opus)', used_percent: 56, resets_at_text: 'Jul 13 at 2am (America/Los_Angeles)' },
  ]);
  // The reset string is carried, never converted. Nothing anywhere is an epoch.
  for (const w of q.windows) assert.strictEqual(typeof (w as Record<string, unknown>).resets_at, 'undefined');
});

check('the usage-breakdown prose never becomes a window', () => {
  // "91% of your usage ...", "Top skills: /alpha 2%, ..." and "Last 24h · ..."
  // all carry a percent; none carries `% used` after a colon.
  const q = parseClaudeUsage(envelope(HAPPY_RESULT), AT);
  assert.ok(q);
  assert.strictEqual(q.windows.length, 3);
  assert.ok(!q.windows.some((w) => /top skills|usage came from|requests/i.test(w.label)));
});

check('dynamic + unknown window labels are iterated, never hardcoded', () => {
  const q = parseClaudeUsage(envelope([
    'Current session: 1% used · resets Jul 8 at 4:50am (America/Los_Angeles)',
    'Current week (all models): 2% used · resets Jul 13 at 2am (America/Los_Angeles)',
    'Current week (Fable): 3% used · resets Jul 13 at 2am (America/Los_Angeles)',
    'Current week (Some Future Model 4.5): 4% used · resets Jul 13 at 2am (UTC)',
    'Current month (flagged-experiment): 5% used',
    'Some window nobody has shipped yet: 100% used · resets tomorrow',
  ].join('\n')), AT);
  assert.ok(q);
  assert.strictEqual(q.windows.length, 6);
  assert.deepStrictEqual(q.windows.map((w) => w.used_percent), [1, 2, 3, 4, 5, 100]);
  // A window with no reset clause keeps no reset text, rather than a placeholder.
  assert.strictEqual(q.windows[4].label, 'Current month (flagged-experiment)');
  assert.strictEqual(q.windows[4].resets_at_text, undefined);
  assert.strictEqual(q.windows[5].resets_at_text, 'tomorrow');
});

check('a reset clock containing its own colon does not split the label', () => {
  const q = parseClaudeUsage(envelope('Current session: 7% used · resets Jul 8 at 4:49am (America/Los_Angeles)'), AT);
  assert.ok(q);
  assert.strictEqual(q.windows[0].label, 'Current session');
  assert.strictEqual(q.windows[0].resets_at_text, 'Jul 8 at 4:49am (America/Los_Angeles)');
});

check('a --bare-style cost-only summary yields null', () => {
  assert.strictEqual(parseClaudeUsage(envelope(BARE_RESULT), AT), null);
});

check('logged-out / API-key output (no "% used" lines) yields null', () => {
  assert.strictEqual(parseClaudeUsage(envelope(NO_SUBSCRIPTION_RESULT), AT), null);
});

check('is_error: true yields null even when the text looks parseable', () => {
  const poisoned = envelope('Current session: 42% used · resets Jul 8 at 4:50am (UTC)', { is_error: true, subtype: 'error_during_execution' });
  assert.strictEqual(parseClaudeUsage(poisoned, AT), null);
});

check('a transient OAuth 401 body yields null (exit code is never consulted)', () => {
  const four01 = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'API Error: 401 {"type":"error","error":{"type":"authentication_error"}}' });
  assert.strictEqual(parseClaudeUsage(four01, AT), null);
});

check('malformed JSON yields null', () => {
  for (const s of ['', '   ', 'not json', '{', '{"result":', '[]', 'null', '{"result": 12}']) {
    assert.strictEqual(parseClaudeUsage(s, AT), null, `expected null for ${JSON.stringify(s)}`);
  }
});

check('a percentage outside 0..100 is dropped, never clamped', () => {
  const q = parseClaudeUsage(envelope([
    'Current session: 900% used',
    'Current week (all models): 50% used',
  ].join('\n')), AT);
  assert.ok(q);
  assert.deepStrictEqual(q.windows, [{ label: 'Current week (all models)', used_percent: 50 }]);
});

check('a pathological result is capped at 16 windows', () => {
  const many = Array.from({ length: 200 }, (_, i) => `Window ${i}: 1% used`).join('\n');
  const q = parseClaudeUsage(envelope(many), AT);
  assert.ok(q);
  assert.strictEqual(q.windows.length, 16);
});

check('the parser never throws, for any input', () => {
  const nasty = [
    '', ' ', '\n\n', '{}', '[]', 'null', 'undefined', '\t',
    envelope(''), envelope('\n'.repeat(1000)), envelope(':'), envelope(': % used'),
    envelope('a'.repeat(50_000)), envelope('x: 5% used · resets '), envelope('x:  5% used'),
    JSON.stringify({ result: null }), JSON.stringify({ result: { nested: true } }),
    JSON.stringify({ is_error: 'yes', result: 'Current session: 5% used' }),
    '{"result":"unterminated',
    // Non-characters / lone surrogate-ish bytes, written as escapes so this
    // source file stays plain ASCII (a raw U+FFFF makes git treat it as binary).
    '\uFFFF\uFFFE', '\uD800', '\u0000',
  ];
  for (const s of nasty) {
    // Both entry points, both must be total functions.
    assert.doesNotThrow(() => parseClaudeUsage(s, AT), `parseClaudeUsage threw on ${JSON.stringify(s.slice(0, 40))}`);
    assert.doesNotThrow(() => parseUsageWindows(s), `parseUsageWindows threw on ${JSON.stringify(s.slice(0, 40))}`);
  }
});

// ---- the auth gate ----

check('isSubscriptionAuth gates on loggedIn && apiProvider === firstParty', () => {
  assert.strictEqual(isSubscriptionAuth(JSON.stringify({ loggedIn: true, apiProvider: 'firstParty', subscriptionType: 'max' })), true);
  assert.strictEqual(isSubscriptionAuth(JSON.stringify({ loggedIn: false, apiProvider: 'firstParty' })), false);
  assert.strictEqual(isSubscriptionAuth(JSON.stringify({ loggedIn: true, apiProvider: 'bedrock' })), false);
  assert.strictEqual(isSubscriptionAuth(JSON.stringify({ loggedIn: true, apiProvider: 'vertex' })), false);
  assert.strictEqual(isSubscriptionAuth(JSON.stringify({ loggedIn: true })), false);
  assert.strictEqual(isSubscriptionAuth('not json'), false);
  assert.strictEqual(isSubscriptionAuth(''), false);
});

// ---- orchestration, with an injected runner (no spawn) ----

const AUTH_OK = JSON.stringify({ loggedIn: true, apiProvider: 'firstParty', subscriptionType: 'max' });
const BIN = () => '/fake/bin/claude';

function runner(map: { auth?: string | Error; usage?: string | Error }): { run: RunClaude; calls: string[][] } {
  const calls: string[][] = [];
  const run: RunClaude = async (args) => {
    calls.push([...args]);
    const which = args[0] === 'auth' ? map.auth : map.usage;
    if (which === undefined) throw new Error('no fixture for these args');
    if (which instanceof Error) throw which;
    return which;
  };
  return { run, calls };
}

check('readClaudeQuota: happy path, and it asks auth first then usage', async () => {
  const { run, calls } = runner({ auth: AUTH_OK, usage: envelope(HAPPY_RESULT) });
  const q = await readClaudeQuota({ run, resolveBin: BIN, now: () => AT });
  assert.ok(q);
  assert.strictEqual(q.at, AT);
  assert.strictEqual(q.windows.length, 3);
  assert.deepStrictEqual(calls, [[...AUTH_ARGS], [...USAGE_ARGS]]);
  // The flags that keep this cheap and invisible are actually passed.
  assert.ok(USAGE_ARGS.includes('--safe-mode'));
  assert.ok(USAGE_ARGS.includes('--no-session-persistence'));
  assert.ok(!USAGE_ARGS.includes('--bare'), '--bare strips OAuth and must never be passed');
});

check('readClaudeQuota: no binary -> null, and the runner is never called', async () => {
  const { run, calls } = runner({ auth: AUTH_OK, usage: envelope(HAPPY_RESULT) });
  assert.strictEqual(await readClaudeQuota({ run, resolveBin: () => null }), null);
  assert.strictEqual(calls.length, 0, 'a missing binary must short-circuit before any spawn');
});

check('readClaudeQuota: not a first-party subscription -> null, and /usage is never run', async () => {
  for (const auth of [JSON.stringify({ loggedIn: false }), JSON.stringify({ loggedIn: true, apiProvider: 'bedrock' })]) {
    const { run, calls } = runner({ auth, usage: envelope(HAPPY_RESULT) });
    assert.strictEqual(await readClaudeQuota({ run, resolveBin: BIN }), null);
    assert.deepStrictEqual(calls, [[...AUTH_ARGS]], 'the auth gate must precede the usage spawn');
  }
});

check('readClaudeQuota: a spawn failure at either step -> null, never a throw', async () => {
  const a = await readClaudeQuota({ run: runner({ auth: new Error('ENOENT') }).run, resolveBin: BIN });
  assert.strictEqual(a, null);
  const b = await readClaudeQuota({ run: runner({ auth: AUTH_OK, usage: new Error('AbortError: timed out') }).run, resolveBin: BIN });
  assert.strictEqual(b, null);
});

check('readClaudeQuota: is_error / bare / malformed usage output all degrade to null', async () => {
  for (const usage of [
    envelope(BARE_RESULT),
    envelope(NO_SUBSCRIPTION_RESULT),
    envelope('Current session: 5% used', { is_error: true }),
    'not json at all',
  ]) {
    const q = await readClaudeQuota({ run: runner({ auth: AUTH_OK, usage }).run, resolveBin: BIN });
    assert.strictEqual(q, null, `expected null for ${usage.slice(0, 48)}`);
  }
});

// ---- binary resolution (fs only, no spawn) ----

check('findClaudeBin returns null when PATH is empty and no fallback exists', () => {
  assert.strictEqual(findClaudeBin({ PATH: '' }, '/nonexistent-home-for-selftest'), null);
  assert.strictEqual(findClaudeBin({}, '/nonexistent-home-for-selftest'), null);
});

Promise.all(pending).then(() => {
  if (process.exitCode) console.error(`claude-quota selftest: FAILURES (passed ${passed})`);
  else console.log(`claude-quota selftest: ${passed} checks passed`);
});
