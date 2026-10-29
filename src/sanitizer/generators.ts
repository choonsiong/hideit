import type { Category, SpanKind } from "./types";
import { pick, randomString, type Rng } from "./random";

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const NONZERO_DIGITS = "123456789";
const ALNUM = UPPER + LOWER + DIGITS;
const HEX_LOWER = "0123456789abcdef";
const HEX_UPPER = "0123456789ABCDEF";

// Documentation-only address blocks (RFC 5737), so fake IPs never point at a real host.
const TEST_NETS = ["192.0.2", "198.51.100", "203.0.113"];

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
const JWT_RE = /^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/;

/** Prefixes kept verbatim so a fake token still shows which service it belongs to. Longest first. */
export const TOKEN_PREFIXES = [
  "github_pat_", "sk-ant-api03-", "sk-ant-", "sk-proj-",
  "sk_live_", "sk_test_", "pk_live_", "pk_test_", "rk_live_", "rk_test_",
  "glpat-", "xoxb-", "xoxp-", "xoxa-", "xoxo-", "xoxr-", "xoxs-",
  "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "npm_", "AKIA", "ASIA", "AIza", "sk-",
].sort((a, b) => b.length - a.length);

/** Length of the escape sequence starting at value[i] === "\\" (\n, \", \uXXXX, \xXX). */
function escapeLength(value: string, i: number): number {
  const next = value[i + 1];
  if (next === undefined) return 1;
  if (next === "u" && /^[0-9a-fA-F]{4}$/.test(value.slice(i + 2, i + 6))) return 6;
  if (next === "x" && /^[0-9a-fA-F]{2}$/.test(value.slice(i + 2, i + 4))) return 4;
  return 2;
}

/**
 * Replace every letter and digit with a random one of the same class, keeping length,
 * separators and backslash escapes. Hex strings stay hex.
 */
export function scramble(value: string, rng: Rng): string {
  const alnum = value.replace(/\\(?:u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)|[^A-Za-z0-9]/g, "");
  const isHex = /^[0-9a-fA-F]+$/.test(alnum) && /[a-fA-F]/.test(alnum) && /\d/.test(alnum);
  const hexAlphabet = /[A-F]/.test(alnum) && !/[a-f]/.test(alnum) ? HEX_UPPER : HEX_LOWER;

  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === "\\") {
      const len = escapeLength(value, i);
      out += value.slice(i, i + len);
      i += len - 1;
    } else if (isHex && /[0-9a-fA-F]/.test(c)) {
      out += pick(rng, hexAlphabet);
    } else if (c >= "A" && c <= "Z") {
      out += pick(rng, UPPER);
    } else if (c >= "a" && c <= "z") {
      out += pick(rng, LOWER);
    } else if (c >= "0" && c <= "9") {
      out += pick(rng, DIGITS);
    } else {
      out += c;
    }
  }
  return out;
}

/** Random digits of the same length; a non-zero leading digit stays non-zero so JSON numbers stay valid. */
function scrambleNumber(value: string, rng: Rng): string {
  let leading = true;
  return value.replace(/\d/g, (d) => {
    const alphabet = leading && d !== "0" ? NONZERO_DIGITS : DIGITS;
    leading = false;
    return pick(rng, alphabet);
  });
}

export function hasTokenPrefix(value: string): boolean {
  return TOKEN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function fakeToken(value: string, rng: Rng): string {
  if (JWT_RE.test(value)) {
    return value
      .split(".")
      .map((segment, i) => (i < 2 ? "eyJ" + scramble(segment.slice(3), rng) : scramble(segment, rng)))
      .join(".");
  }
  const prefix = TOKEN_PREFIXES.find((p) => value.startsWith(p)) ?? "";
  return prefix + scramble(value.slice(prefix.length), rng);
}

export function fakeEmail(rng: Rng): string {
  return `${randomString(rng, LOWER, 8)}@example.com`;
}

/** Fixed length on purpose: preserving the length would leak information about the real password. */
export function fakePassword(rng: Rng): string {
  return randomString(rng, ALNUM, 16);
}

export function fakeUuid(original: string, rng: Rng): string {
  const hex = () => pick(rng, HEX_LOWER);
  const chunk = (n: number) => Array.from({ length: n }, hex).join("");
  const variant = pick(rng, "89ab");
  const uuid = `${chunk(8)}-${chunk(4)}-4${chunk(3)}-${variant}${chunk(3)}-${chunk(12)}`;
  return /[A-F]/.test(original) ? uuid.toUpperCase() : uuid;
}

export function fakeIPv4(rng: Rng): string {
  return `${TEST_NETS[rng.int(TEST_NETS.length)]}.${1 + rng.int(254)}`;
}

function luhnCheckDigit(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    let d = Number(payload[payload.length - 1 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return (10 - (sum % 10)) % 10;
}

export function luhnValid(digits: string): boolean {
  return digits.length > 1 && luhnCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

/** Luhn-valid random number with the same network digit, length and separators. */
export function fakeCard(original: string, rng: Rng): string {
  const digits = original.replace(/\D/g, "");
  const payload = digits[0]! + randomString(rng, DIGITS, digits.length - 2);
  const fake = payload + luhnCheckDigit(payload);
  let i = 0;
  return original.replace(/\d/g, () => fake[i++]!);
}

/** Replacement for a value found through a sensitive key: follow the value's shape first, then the key's category. */
function replaceKeyedValue(value: string, category: Category, rng: Rng): string {
  if (UUID_RE.test(value)) return fakeUuid(value, rng);
  if (EMAIL_RE.test(value)) return fakeEmail(rng);
  if (NUMBER_RE.test(value)) return scrambleNumber(value, rng);
  if (JWT_RE.test(value) || hasTokenPrefix(value)) return fakeToken(value, rng);
  switch (category) {
    case "secret":
      return fakePassword(rng);
    case "token":
      return fakeToken(value, rng);
    default:
      return scramble(value, rng);
  }
}

export function generateReplacement(kind: SpanKind, category: Category, value: string, rng: Rng): string {
  switch (kind) {
    case "key":
      return replaceKeyedValue(value, category, rng);
    case "email":
      return fakeEmail(rng);
    case "token":
      return fakeToken(value, rng);
    case "uuid":
      return fakeUuid(value, rng);
    case "pem":
      return scramble(value, rng);
    case "ip":
      return fakeIPv4(rng);
    case "card":
      return fakeCard(value, rng);
    case "password":
      return fakePassword(rng);
  }
}
