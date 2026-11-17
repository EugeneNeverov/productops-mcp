// Deterministic checks for skill reports (spec §8, §11.4). No LLM involved.
// A report passes when every enabled check passes. Each check returns { id, passed, details }.

const SECTION_ALIASES = {
  'roadmap-prioritization': [
    ['recommendation', 'рекомендация'],
    ['what we take', 'что берём', 'что берем'],
    ['trade-offs', 'trade-off', 'компромисс'],
    ['method disagreements', 'disagreements', 'расхождения'],
    ['assumptions', 'допущения'],
    ['reproducibility', 'воспроизводимость'],
  ],
  'sprint-health-audit': [
    ['verdict', 'вердикт', 'итог'],
    ['top risks', 'risks', 'риски'],
    ['actions', 'действия'],
    ['assumptions', 'допущения'],
  ],
};

// Numbers a skill's instructions give the model, which it may quote without a tool returning them.
const SKILL_CONSTANTS = {
  'sprint-health-audit': [100, 7, 15], // healthScore scale and the warn/risk penalties in SKILL.md
};

const ID_RE = /\b[A-Z][A-Z0-9]*-\d+\b/g;
const HASH_RE = /sha256:[0-9a-f]{8,64}/g;
const NUMBER_RE = /(?<![\w.])-?\d+(?:[.,]\d+)?(?:%|(?:st|nd|rd|th)\b)?/g;

/** All numbers found anywhere in a JSON value, including inside strings. */
export function collectNumbers(value, out = new Set()) {
  if (typeof value === 'number' && Number.isFinite(value)) out.add(value);
  else if (typeof value === 'string')
    for (const m of value.match(/-?\d+(?:\.\d+)?/g) ?? []) out.add(Number(m));
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectNumbers(v, out));
  return out;
}

function decimals(token) {
  const m = /[.,](\d+)/.exec(token);
  return m ? m[1].length : 0;
}

/** Does a number written in the report correspond to one of the allowed source numbers? */
export function numberMatches(token, allowed) {
  const isPct = token.endsWith('%');
  const x = Number(token.replace(/%|st|nd|rd|th/g, '').replace(',', '.'));
  const tol = 0.5 * 10 ** -decimals(token) + 1e-9;
  for (const y of allowed) {
    if (Math.abs(x - y) <= tol) return true;
    if (Math.abs(Math.abs(x) - Math.abs(y)) <= tol) return true; // "fell by 16.67%" for changePct −16.67
    if (isPct && Math.abs(x - y * 100) <= tol) return true; // ratio 0.5 → 50%
    if (isPct && Math.abs(Math.abs(x) - Math.abs((y - 1) * 100)) <= tol) return true; // multiplier 1.3 → 30%
  }
  return false;
}

function stripIgnored(report) {
  return report
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(HASH_RE, ' ')
    .replace(ID_RE, ' ')
    .replace(/^\s*\d+\.\s/gm, ' ') // ordered-list markers
    .replace(/^#+.*$/gm, (h) => h.replace(/\d+/g, ' ')); // numbers in headings ("Q1", "Top 3")
}

/**
 * @param {object} input
 * @param {string} input.skill          skill name, selects the required sections
 * @param {string} input.report         final markdown answer
 * @param {string} input.prompt         the user's request (numbers in it are allowed)
 * @param {{name: string, args: unknown, result: unknown, isError?: boolean}[]} input.calls
 * @param {object} input.expect         per-case expectations (see evals/README.md)
 */
export function checkReport({ skill, report, prompt, calls, expect = {} }) {
  const results = [];
  const add = (id, passed, details) =>
    results.push({ id, passed, ...(details === undefined ? {} : { details }) });
  const called = new Set(calls.map((c) => c.name));

  for (const tool of expect.mustCall ?? [])
    add(
      `calls:${tool}`,
      called.has(tool),
      called.has(tool) ? undefined : `not called; called: ${[...called].join(', ') || 'nothing'}`,
    );
  for (const tool of expect.mustNotCall ?? []) add(`no-call:${tool}`, !called.has(tool));

  if (expect.asksQuestion) {
    add(
      'asks-question',
      /\?\s*$/m.test(report) || /\?/.test(report.split('\n').slice(-6).join('\n')),
      'expected a clarifying question',
    );
  }

  if (expect.sections !== false && !expect.asksQuestion) {
    const headings = (report.match(/^#{1,4}\s+.+$/gm) ?? []).map((h) => h.toLowerCase());
    const missing = (SECTION_ALIASES[skill] ?? []).filter(
      (aliases) => !headings.some((h) => aliases.some((a) => h.includes(a))),
    );
    add(
      'sections',
      missing.length === 0,
      missing.length ? `missing: ${missing.map((a) => a[0]).join(', ')}` : undefined,
    );
  }

  const words = report.split(/\s+/).filter(Boolean).length;
  const maxWords = expect.maxWords ?? 700;
  add('length', words <= maxWords, `${words} words (max ${maxWords})`);

  // Numbers: everything in the report must come from tool arguments, tool results or the prompt.
  const allowed = new Set();
  collectNumbers(prompt, allowed);
  for (const n of SKILL_CONSTANTS[skill] ?? []) allowed.add(n);
  for (const c of calls) {
    collectNumbers(c.args, allowed);
    collectNumbers(c.result, allowed);
  }
  const tokens = stripIgnored(report).match(NUMBER_RE) ?? [];
  const unknownNumbers = [...new Set(tokens.filter((t) => !numberMatches(t, allowed)))];
  add(
    'numbers-from-tools',
    unknownNumbers.length === 0,
    unknownNumbers.length
      ? `not found in tool data: ${unknownNumbers.join(', ')}`
      : `${tokens.length} numbers checked`,
  );

  // Ids: every id-like token must have been returned by a tool or given by the user.
  const knownText = JSON.stringify(calls.map((c) => [c.args, c.result])) + prompt;
  const ids = [...new Set(report.replace(HASH_RE, ' ').match(ID_RE) ?? [])];
  const unknownIds = ids.filter((id) => !knownText.includes(id));
  add(
    'ids-from-tools',
    unknownIds.length === 0,
    unknownIds.length ? `unknown: ${unknownIds.join(', ')}` : undefined,
  );

  for (const id of expect.mustMention ?? [])
    add(`mentions:${id}`, report.toLowerCase().includes(id.toLowerCase()));
  for (const phrase of expect.forbid ?? [])
    add(`forbid:${phrase}`, !report.toLowerCase().includes(phrase.toLowerCase()));

  if (expect.reproducibility !== false && !expect.asksQuestion && skill === 'roadmap-prioritization') {
    const hashes = calls.map((c) => c.result?.meta?.inputHash).filter(Boolean);
    const cited = (report.match(HASH_RE) ?? []).filter((h) => hashes.some((full) => full.startsWith(h)));
    add(
      'cites-input-hash',
      cited.length > 0,
      cited.length ? undefined : 'no meta.inputHash from the tool results is cited',
    );
  }

  // sprint-health-audit: risks must cite evidence as links to issues the tools returned.
  if (expect.evidence !== false && !expect.asksQuestion && skill === 'sprint-health-audit') {
    const urls = new Set();
    const collectUrls = (v) => {
      if (typeof v === 'string' && /^https?:\/\/\S+\/browse\/[A-Z][A-Z0-9]*-\d+$/.test(v)) urls.add(v);
      else if (Array.isArray(v)) v.forEach(collectUrls);
      else if (v && typeof v === 'object') Object.values(v).forEach(collectUrls);
    };
    calls.forEach((c) => collectUrls(c.result));
    const linked = [...report.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]);
    const cited = linked.filter((u) => urls.has(u));
    const foreign = linked.filter((u) => /\/browse\//.test(u) && !urls.has(u));
    add(
      'cites-evidence',
      cited.length > 0 && foreign.length === 0,
      foreign.length
        ? `issue links no tool returned: ${foreign.join(', ')}`
        : cited.length
          ? `${cited.length} evidence links`
          : 'no issue link from the tool results is cited',
    );
  }

  if (expect.language === 'ru')
    add(
      'language:ru',
      /[а-яё]{4,}/i.test(report) &&
        (report.match(/[а-яё]/gi) ?? []).length > (report.match(/[a-z]/gi) ?? []).length / 2,
    );

  return { passed: results.every((r) => r.passed), words, checks: results };
}
