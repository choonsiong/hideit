import { describe, expect, it } from "vitest";
import { fakeCard, fakeIPv4, fakeToken, fakeUuid, luhnValid, scramble, UUID_RE } from "../src/sanitizer/generators";
import { createSeededRng } from "../src/sanitizer/random";

const rng = () => createSeededRng(7);
const classOf = (c: string) => (/[A-Z]/.test(c) ? "A" : /[a-z]/.test(c) ? "a" : /\d/.test(c) ? "0" : c);
const shape = (s: string) => [...s].map(classOf).join("");

describe("scramble", () => {
  it("keeps length, character classes and separators", () => {
    const original = "Abc-123_xyZ.9";
    const out = scramble(original, rng());
    expect(out).not.toBe(original);
    expect(shape(out)).toBe(shape(original));
  });

  it("keeps backslash escapes intact", () => {
    const out = scramble("ab\\ncd\\\"ef\\u00e9gh", rng());
    expect(out).toMatch(/^[a-z]{2}\\n[a-z]{2}\\"[a-z]{2}\\u00e9[a-z]{2}$/);
  });

  it("keeps hex strings hex", () => {
    expect(scramble("deadbeef0123456789", rng())).toMatch(/^[0-9a-f]{18}$/);
    expect(scramble("DEADBEEF01234567", rng())).toMatch(/^[0-9A-F]{16}$/);
  });
});

describe("fakeToken", () => {
  it("keeps known prefixes", () => {
    const github = "gh" + "p_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
    const anthropic = "sk-" + "ant-api03-" + "abcdefghijklmnopqrstuvwxyz0123";
    expect(fakeToken(github, rng())).toMatch(/^ghp_[A-Za-z0-9]{36}$/);
    expect(fakeToken(anthropic, rng())).toMatch(/^sk-ant-api03-[a-z0-9]{30}$/);
  });

  it("keeps the shape of a JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const out = fakeToken(jwt, rng());
    const segments = out.split(".");
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatch(/^eyJ/);
    expect(segments[1]).toMatch(/^eyJ/);
    expect(out).toHaveLength(jwt.length);
    expect(out).not.toBe(jwt);
  });
});

describe("other generators", () => {
  it("fakeUuid returns a v4 UUID in the original's case", () => {
    expect(fakeUuid("550e8400-e29b-41d4-a716-446655440000", rng())).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const upper = fakeUuid("550E8400-E29B-41D4-A716-446655440000", rng());
    expect(UUID_RE.test(upper)).toBe(true);
    expect(upper).toBe(upper.toUpperCase());
  });

  it("fakeCard is Luhn-valid with the same network digit and separators", () => {
    const out = fakeCard("4111 1111 1111 1111", rng());
    expect(out).toMatch(/^4\d{3} \d{4} \d{4} \d{4}$/);
    expect(luhnValid(out.replace(/\D/g, ""))).toBe(true);
  });

  it("fakeIPv4 uses documentation ranges", () => {
    for (let i = 0; i < 20; i++) {
      expect(fakeIPv4(createSeededRng(i))).toMatch(/^(?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d{1,3}$/);
    }
  });

  it("luhnValid", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(luhnValid("4111111111111112")).toBe(false);
  });
});
