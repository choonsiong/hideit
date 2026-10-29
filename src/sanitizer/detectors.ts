import type { Category, Span, SpanKind } from "./types";
import { keyCategory, normalizeKey } from "./keys";
import { luhnValid } from "./generators";

/**
 * Higher wins when spans overlap. Key-based matches beat generic patterns; PEM blocks beat everything.
 * Custom words come last so a word inside an email or secret never leaves the rest of it behind.
 */
const PRIORITY: Record<SpanKind, number> = {
  pem: 100,
  key: 50,
  password: 50,
  token: 40,
  email: 30,
  uuid: 20,
  card: 15,
  ip: 10,
  word: 5,
};

interface Range {
  start: number;
  end: number;
}

// Characters that end an unquoted value such as `token=abc&x=1` or `"id": 42,`.
const BARE_STOP = /[\s,;&"'`<>(){}[\]\\]/;
const LINE_STOP = /[\r\n"'`]/;

// Values that are not secrets: literals, masks, type names and template/env placeholders.
const PLACEHOLDER_RE = new RegExp(
  "^(?:" +
    [
      "null|nil|none|true|false|undefined|yes|no|on|off",
      "str|string|int|integer|number|bool|boolean|float|double|bytes|any|object|unknown",
      String.raw`\*+|[•xX#._-]{3,}`,
      String.raw`\[?redacted\]?`,
      String.raw`\$\{\{.*\}\}|\$\{[^}]*\}|\{\{.*\}\}|<[^<>]*>|%[A-Za-z_]\w*%`,
      // File paths and URLs (credentials inside URLs are handled by URL_CREDENTIALS_RE and query keys).
      String.raw`(?:~|\.{1,2})?/.*|[a-z][a-z0-9+.-]*://.*`,
    ].join("|") +
    ")$",
  "i",
);
// $DB_PASS is a reference to a secret, but $ecret could be the secret itself, so this one is case-sensitive.
const ENV_REFERENCE_RE = /^\$[A-Z_][A-Z0-9_]*$/;

const isPlaceholder = (value: string) => PLACEHOLDER_RE.test(value) || ENV_REFERENCE_RE.test(value);

// An unquoted template reference such as ${SECRET} or {{ .Values.token }}; reading it as a bare value would stop at "{".
const TEMPLATE_STICKY_RE = /\$\{\{.*?\}\}|\$\{[^}\s]*\}|\{\{.*?\}\}/y;
const AUTH_SCHEME_STICKY_RE = /(?:Bearer|Basic|Token|Bot|JWT)[ \t]+/iy;
const AUTH_SCHEME_PREFIX_RE = /^(?:Bearer|Basic|Token|Bot|JWT)[ \t]+/i;
const COOKIE_ATTRIBUTES = new Set(["path", "domain", "expires", "max-age", "samesite", "secure", "httponly", "priority", "partitioned"]);

const SEPARATOR = String.raw`[ \t]*(?:===?|=>|:=|[:=])[ \t]*`;
// "key": / 'key': / \"key\": (JSON, JS, Python, PHP arrays, JSON embedded in a JSON string)
const QUOTED_KEY_RE = new RegExp(String.raw`(\\?)(["'])([^"'\\\r\n]{1,80})\1\2` + SEPARATOR, "g");
// key: / key= / key => (YAML, HTTP headers, .env, query strings, ini, --flag=value, -Dprop=value)
const BARE_KEY_RE = new RegExp(String.raw`(?<![\w.])([A-Za-z_][\w.-]{0,80})` + SEPARATOR, "g");
// --flag value
const CLI_FLAG_RE = /(?<![\w-])--([A-Za-z][\w-]{0,80})[ \t]+(?=[^\s-])/g;
// <password>value</password>
const XML_RE = /<([A-Za-z_][\w.:-]{0,80})(?:\s[^<>]*)?>([^<]{1,10000})<\/\1\s*>/dg;
// curl -u user:password
const CURL_USER_RE = /(?<![\w-])(?:-u|--user)[ \t]+(["']?)([^\s:"']*):([^\s"']+)\1/dg;
// scheme://user:password@host
const URL_CREDENTIALS_RE = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@"'<>]*):([^\s@/"'<>]+)@/dgi;

const PEM_RE = /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?)-----([\s\S]*?)-----END \1-----/dg;
const JWT_RE = /(?<![\w-])eyJ[\w-]{2,}\.eyJ[\w-]{2,}\.[\w-]*/g;
const KNOWN_TOKEN_RE = new RegExp(
  String.raw`(?<![\w-])(?:` +
    [
      String.raw`gh[pousr]_[A-Za-z0-9]{30,}`,
      String.raw`github_pat_\w{20,}`,
      String.raw`glpat-[\w-]{20,}`,
      String.raw`sk-[\w-]{20,}`,
      String.raw`[spr]k_(?:live|test)_[A-Za-z0-9]{16,}`,
      String.raw`xox[abposr]-[\w-]{10,}`,
      String.raw`A(?:KIA|SIA)[0-9A-Z]{16}`,
      String.raw`AIza[\w-]{35}`,
      String.raw`npm_[A-Za-z0-9]{36}`,
    ].join("|") +
    String.raw`)(?![\w-])`,
  "g",
);
const BEARER_RE = /\b(?:Bearer|Basic)[ \t]+([A-Za-z0-9\-._~+/]{8,}=*)/dg;
const EMAIL_RE = /(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![\w-])/g;
const UUID_RE = /(?<![\w-])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![\w-])/g;
const IPV4_RE = /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\w|\.\d)/g;
const CARD_RE = /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g;

const isQuote = (c: string | undefined) => c === '"' || c === "'" || c === "`";

/** Read the value starting at `pos`: a quoted string (contents only), or an unquoted run of characters. */
function readValue(text: string, pos: number, toLineEnd: boolean): Range | null {
  const c = text[pos];
  if (c === "\\" && isQuote(text[pos + 1])) {
    const quote = text.slice(pos, pos + 2);
    const end = text.indexOf(quote, pos + 2);
    const newline = text.indexOf("\n", pos);
    if (end < 0 || (newline >= 0 && newline < end)) return null;
    return { start: pos + 2, end };
  }
  if (isQuote(c)) {
    let i = pos + 1;
    while (i < text.length && text[i] !== c && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
    if (text[i] !== c) return null;
    return { start: pos + 1, end: i };
  }
  const stop = toLineEnd ? LINE_STOP : BARE_STOP;
  let i = pos;
  while (i < text.length && !stop.test(text[i]!)) i++;
  return i > pos ? { start: pos, end: i } : null;
}

/** Elements of a flat array such as `[123, "abc"]`. Stops at nested arrays or objects. */
function readArrayValues(text: string, pos: number): Range[] {
  const ranges: Range[] = [];
  let i = pos + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i]!)) i++;
    const c = text[i];
    if (c === undefined || c === "]" || c === "[" || c === "{") break;
    const range = readValue(text, i, false);
    if (!range) break;
    ranges.push(range);
    // Step past the closing quote (or escaped quote) of a string element.
    i = isQuote(c) ? range.end + 1 : c === "\\" ? range.end + 2 : range.end;
  }
  return ranges;
}

class SpanCollector {
  readonly spans: Span[] = [];

  constructor(
    private readonly text: string,
    private readonly customKeys: ReadonlySet<string>,
  ) {}

  add(start: number, end: number, category: Category, kind: SpanKind): void {
    if (end > start) this.spans.push({ start, end, category, kind, priority: PRIORITY[kind] });
  }

  /** Add a value found through a key, trimmed, unless it is a placeholder. */
  addKeyedValue(range: Range, category: Category, kind: SpanKind = "key"): void {
    let { start, end } = range;
    while (start < end && /\s/.test(this.text[start]!)) start++;
    while (end > start && /\s/.test(this.text[end - 1]!)) end--;
    if (end > start && !isPlaceholder(this.text.slice(start, end))) this.add(start, end, category, kind);
  }

  /** `key` was followed by a separator; its value starts at `pos`. */
  keyValue(key: string, pos: number): void {
    const category = keyCategory(key, this.customKeys);
    if (!category) return;
    const text = this.text;

    if (text[pos] === "[") {
      for (const range of readArrayValues(text, pos)) this.addKeyedValue(range, category);
      return;
    }

    const norm = normalizeKey(key);
    const isCookie = norm === "cookie" || norm === "setcookie";
    if (!isQuote(text[pos]) && text[pos] !== "\\") {
      // Keep the scheme in "Authorization: Bearer <token>".
      AUTH_SCHEME_STICKY_RE.lastIndex = pos;
      if (AUTH_SCHEME_STICKY_RE.exec(text)) pos = AUTH_SCHEME_STICKY_RE.lastIndex;
    }

    TEMPLATE_STICKY_RE.lastIndex = pos;
    if (TEMPLATE_STICKY_RE.test(text)) return;

    const range = readValue(text, pos, isCookie);
    if (!range) return;
    if (isCookie) {
      this.cookieValues(range, category);
      return;
    }
    const scheme = AUTH_SCHEME_PREFIX_RE.exec(text.slice(range.start, range.end));
    if (scheme) range.start += scheme[0].length;
    this.addKeyedValue(range, category);
  }

  /** Replace cookie values but keep cookie names and attributes like Path or Expires. */
  private cookieValues(range: Range, category: Category): void {
    const body = this.text.slice(range.start, range.end);
    let found = false;
    for (const m of body.matchAll(/([^=;\s]+)[ \t]*=[ \t]*([^;]*)/dg)) {
      found = true;
      const name = m[1]!;
      const value = m[2]!.trim();
      if (COOKIE_ATTRIBUTES.has(name.toLowerCase())) continue;
      // Keep harmless preferences such as theme=dark; replace anything named or shaped like a token.
      if (!keyCategory(name, this.customKeys) && !(value.length >= 8 && /\d/.test(value)) && value.length < 20) continue;
      const [start, end] = m.indices![2]!;
      this.addKeyedValue({ start: range.start + start, end: range.start + end }, category);
    }
    if (!found) this.addKeyedValue(range, category);
  }
}

function looksLikeCard(digits: string): boolean {
  const n = digits.length;
  const network =
    (digits[0] === "4" && (n === 13 || n === 16 || n === 19)) ||
    (/^(?:5[1-5]|222[1-9]|22[3-9]\d|2[3-6]\d\d|27[01]\d|2720)/.test(digits) && n === 16) ||
    (/^3[47]/.test(digits) && n === 15) ||
    (/^(?:6011|65|64[4-9])/.test(digits) && n >= 16 && n <= 19) ||
    (/^35(?:2[89]|[3-8]\d)/.test(digits) && n >= 16 && n <= 19) ||
    (/^3(?:0[0-5]|[68])/.test(digits) && n === 14);
  return network && luhnValid(digits);
}

function isNonSensitiveIp(ip: string): boolean {
  return ip === "0.0.0.0" || /^(?:127|255)\./.test(ip) || /^(?:192\.0\.2|198\.51\.100|203\.0\.113)\./.test(ip);
}

/**
 * Matches any of `words`, case-insensitively, when not touching another ASCII letter or digit:
 * "alexkim" matches in "/Users/alexkim/" and "alexkim_backup", but "lee" doesn't match in "sleep".
 */
export function customWordsRegex(words: readonly string[]): RegExp | null {
  const unique = [...new Set(words.map((w) => w.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return null;
  const alternatives = unique.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(`(?<![A-Za-z0-9])(?:${alternatives})(?![A-Za-z0-9])`, "giu");
}

/** Every candidate span in `text`, possibly overlapping. */
export function detect(
  text: string,
  customKeys: ReadonlySet<string> = new Set(),
  customWords: readonly string[] = [],
): Span[] {
  const c = new SpanCollector(text, customKeys);
  const end = (m: RegExpExecArray | RegExpMatchArray) => m.index! + m[0].length;

  for (const m of text.matchAll(QUOTED_KEY_RE)) c.keyValue(m[3]!, end(m));
  for (const m of text.matchAll(BARE_KEY_RE)) c.keyValue(m[1]!, end(m));
  for (const m of text.matchAll(CLI_FLAG_RE)) c.keyValue(m[1]!, end(m));

  for (const m of text.matchAll(XML_RE)) {
    const category = keyCategory(m[1]!.split(":").pop()!, customKeys);
    const [start, stop] = m.indices![2]!;
    if (category) c.addKeyedValue({ start, end: stop }, category);
  }
  for (const m of text.matchAll(CURL_USER_RE)) {
    if (/^\d+$/.test(m[2]!) && /^\d+$/.test(m[3]!)) continue; // uid:gid, e.g. docker run -u 1000:1000
    const [start, stop] = m.indices![3]!;
    c.addKeyedValue({ start, end: stop }, "secret", "password");
  }
  for (const m of text.matchAll(URL_CREDENTIALS_RE)) {
    const [start, stop] = m.indices![2]!;
    c.addKeyedValue({ start, end: stop }, "secret", "password");
  }

  for (const m of text.matchAll(PEM_RE)) {
    const [start, stop] = m.indices![2]!;
    c.add(start, stop, "privateKey", "pem");
  }
  for (const m of text.matchAll(JWT_RE)) c.add(m.index!, end(m), "token", "token");
  for (const m of text.matchAll(KNOWN_TOKEN_RE)) c.add(m.index!, end(m), "token", "token");
  for (const m of text.matchAll(BEARER_RE)) {
    const token = m[1]!;
    // Skip prose such as "Bearer authentication": real tokens contain digits or are long.
    if (!/\d/.test(token) && token.length < 20) continue;
    const [start, stop] = m.indices![1]!;
    c.add(start, stop, "token", "token");
  }
  for (const m of text.matchAll(EMAIL_RE)) c.add(m.index!, end(m), "email", "email");
  for (const m of text.matchAll(UUID_RE)) {
    if (/^[0-]+$/.test(m[0])) continue; // nil UUID
    c.add(m.index!, end(m), "id", "uuid");
  }
  for (const m of text.matchAll(IPV4_RE)) {
    if (!isNonSensitiveIp(m[0])) c.add(m.index!, end(m), "ip", "ip");
  }
  for (const m of text.matchAll(CARD_RE)) {
    if (looksLikeCard(m[0].replace(/\D/g, ""))) c.add(m.index!, end(m), "card", "card");
  }
  const wordsRe = customWordsRegex(customWords);
  if (wordsRe) {
    for (const m of text.matchAll(wordsRe)) c.add(m.index!, end(m), "word", "word");
  }

  return c.spans;
}

/** Keep the highest-priority (then longest) spans so no two overlap; result is sorted by position. */
export function resolveOverlaps(spans: Span[]): Span[] {
  const ordered = [...spans].sort(
    (a, b) => b.priority - a.priority || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const accepted: Span[] = [];
  for (const span of ordered) {
    // Binary search for the first accepted span starting at or after this one.
    let lo = 0;
    let hi = accepted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (accepted[mid]!.start < span.start) lo = mid + 1;
      else hi = mid;
    }
    const prev = accepted[lo - 1];
    const next = accepted[lo];
    if ((prev && prev.end > span.start) || (next && next.start < span.end)) continue;
    accepted.splice(lo, 0, span);
  }
  return accepted;
}
