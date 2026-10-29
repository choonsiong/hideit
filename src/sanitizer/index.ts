import { detect, resolveOverlaps } from "./detectors";
import { generateReplacement } from "./generators";
import { normalizeKey } from "./keys";
import { createCryptoRng, type Rng } from "./random";
import type { Category, Finding, SanitizeOptions, SanitizeResult, Span } from "./types";

export * from "./types";

const defaultRng = createCryptoRng();
const MAX_ATTEMPTS = 10;

export interface SanitizeContext {
  rng?: Rng;
  /**
   * original → replacement, used in consistent mode. Pass the same map across calls to keep
   * replacements stable while the input is edited; clear it to get fresh values.
   */
  memory?: Map<string, string>;
}

export function sanitize(input: string, options: SanitizeOptions, context: SanitizeContext = {}): SanitizeResult {
  const rng = context.rng ?? defaultRng;
  const memory = options.consistent ? (context.memory ?? new Map<string, string>()) : null;
  const customKeys = new Set(options.extraKeys.map(normalizeKey).filter(Boolean));
  const enabled = (category: Category) => category === "custom" || options.categories[category];
  const spans = resolveOverlaps(detect(input, customKeys).filter((span) => enabled(span.category)));
  const used = new Set<string>(memory?.values());

  const replacementFor = (span: Span, original: string): string => {
    const remembered = memory?.get(original);
    if (remembered !== undefined) return remembered;
    let fake = original;
    for (let attempt = 0; attempt < MAX_ATTEMPTS && (fake === original || used.has(fake)); attempt++) {
      fake = generateReplacement(span.kind, span.category, original, rng);
    }
    if (fake !== original) {
      used.add(fake);
      memory?.set(original, fake);
    }
    return fake;
  };

  const parts: string[] = [];
  const findings: Finding[] = [];
  let outputLength = 0;
  let last = 0;
  for (const span of spans) {
    const original = input.slice(span.start, span.end);
    const replacement = replacementFor(span, original);
    if (replacement === original) continue; // nothing to hide, e.g. a value with no letters or digits
    const before = input.slice(last, span.start);
    parts.push(before, replacement);
    outputLength += before.length;
    findings.push({ category: span.category, start: outputLength, end: outputLength + replacement.length });
    outputLength += replacement.length;
    last = span.end;
  }
  parts.push(input.slice(last));

  return { output: parts.join(""), findings };
}

export function countByCategory(findings: readonly Finding[]): Map<Category, number> {
  const counts = new Map<Category, number>();
  for (const { category } of findings) counts.set(category, (counts.get(category) ?? 0) + 1);
  return counts;
}
