import { describe, expect, it } from "vitest";
import { detect, resolveOverlaps } from "../src/sanitizer/detectors";
import type { Span } from "../src/sanitizer/types";

const span = (start: number, end: number, priority: number): Span => ({ start, end, priority, category: "token", kind: "token" });

describe("resolveOverlaps", () => {
  it("keeps the higher-priority span, then the longer one, sorted by position", () => {
    const kept = resolveOverlaps([span(0, 10, 10), span(5, 8, 50), span(20, 30, 10), span(20, 25, 10), span(12, 14, 1)]);
    expect(kept.map((s) => [s.start, s.end])).toEqual([
      [5, 8],
      [12, 14],
      [20, 30],
    ]);
  });

  it("allows touching spans", () => {
    expect(resolveOverlaps([span(0, 5, 1), span(5, 10, 1)])).toHaveLength(2);
  });
});

describe("detect", () => {
  it("prefers the key-based match over a generic pattern on the same value", () => {
    const text = '"user_email": "a@b.com"';
    const [kept] = resolveOverlaps(detect(text));
    expect(kept).toMatchObject({ kind: "key", category: "email" });
    expect(text.slice(kept!.start, kept!.end)).toBe("a@b.com");
  });

  it("keeps the auth scheme out of the span", () => {
    const text = "Authorization: Basic dXNlcjpwYXNz";
    const [kept] = resolveOverlaps(detect(text));
    expect(text.slice(kept!.start, kept!.end)).toBe("dXNlcjpwYXNz");
  });

  it("matches URL credentials without swallowing the host as an email", () => {
    const text = "postgres://admin:s3cr3t@db.example.com:5432/app";
    const kept = resolveOverlaps(detect(text));
    expect(kept.map((s) => text.slice(s.start, s.end))).toEqual(["s3cr3t"]);
  });
});
