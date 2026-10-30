# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

HideIt is a browser-only single-page app that replaces sensitive data in pasted text with random values. `README.md` holds the user-facing behaviour, the detection tables, the known limitations and a file-by-file layout. A change to what gets detected usually needs a matching change there.

## Commands

```bash
npm run dev                          # dev server at http://localhost:5173
npm test                             # all tests, once (Vitest)
npx vitest run tests/keys.test.ts    # one file
npx vitest run -t "resolveOverlaps"  # tests whose name matches
npm run test:watch                   # watch mode
npm run typecheck                    # tsc --noEmit, including tests/ and vite.config.ts
npm run build                        # type-check, then build into dist/
npm run preview                      # serve dist/ at http://localhost:4173
```

No linter or formatter is configured.

To verify a change, run `npm test` and `npm run build`, the same steps as `deploy.yml`. No workflow runs on pull requests, so a failure on a branch only shows up in the deploy after it merges. Tests cover `src/sanitizer/` only, so check changes to `main.ts`, `index.html` or `style.css` in a browser.

## Architecture

`sanitize()` in `src/sanitizer/index.ts` is the whole pipeline. `src/main.ts` calls it on each edit and renders the result.

1. `detect()` (`detectors.ts`) runs every detector over the raw text and returns candidate spans, which may overlap. Key/value detectors ask `keyCategory()` (`keys.ts`) whether a key name is sensitive, then skip placeholder values such as `$DB_PASS` or `<your-key>`.
2. Spans from disabled categories are dropped before overlaps are resolved, so a disabled category can't shadow an enabled one. `custom` and `word` are always on.
3. `resolveOverlaps()` keeps the highest `PRIORITY` span, then the longest.
4. `generateReplacement()` (`generators.ts`) produces each replacement, and the output is spliced together from the original text. A replacement equal to the original is skipped.

Concepts that span these files:

- **`Category` vs `SpanKind`:** the category is what the user sees and toggles. The kind picks the generator and the priority. A `key` span was found through a key name, so `replaceKeyedValue` looks at the value's shape first and only then falls back to the category.
- **Memory:** the `memory` map (original → replacement) belongs to `main.ts` and carries across calls, so replacements stay stable while the user types. Regenerate, Clear, Load sample and toggling consistent mode all reset it, as does passing `MEMORY_LIMIT`. Custom word pseudonyms live in the same map under `WORD_KEY_PREFIX`, and are kept even when consistent mode is off.
- **Findings:** `start` and `end` are offsets into the output, not the input.

Changes that touch several files:

- **New token format:** add it to `KNOWN_TOKEN_RE` (`detectors.ts`) and its prefix to `TOKEN_PREFIXES` (`generators.ts`), or the fake token loses the prefix.
- **Email, UUID or JWT shape:** each has a search regex in `detectors.ts` and an anchored one in `generators.ts`.
- **New category:** the compiler enforces `CATEGORY_LABELS` (`types.ts`) and `NOUNS` (`main.ts`). It doesn't enforce the `--c-<name>` colour and `.cat-<name>` rule in `style.css`, or `TOGGLEABLE_CATEGORIES` and `defaultOptions` for a category the user can switch.

## Constraints

- **Privacy is the product.** Pasted input must never leave the page or be stored. Only settings go in `localStorage`. There are no runtime dependencies.
- **The CSP exists only in production builds.** `vite.config.ts` injects it at build time because the dev server needs a websocket. Inline scripts, inline styles and network calls therefore work under `npm run dev` and fail once deployed, so check them with `npm run build && npm run preview`. This is why `public/theme.js` is a separate file. It shares the `hideit:theme` key with `main.ts`.
- **Output goes through text nodes only**, never `innerHTML`, so pasted input can't be interpreted as HTML.
- **Text is edited in place by span offsets**, never parsed and re-serialized. This keeps formatting and large numeric IDs intact.
- **All randomness comes through the `Rng` parameter**, never `Math.random`. The app uses `createCryptoRng`; tests pass `createSeededRng` so results are reproducible.
- **Fake values are deliberately harmless.** Passwords are a fixed 16 characters so the real length isn't revealed, emails use `example.com`, and IPs come from the RFC 5737 documentation ranges.
- **`src/sanitizer/` has no DOM dependency**, so it can be reused outside the browser.

## Tests

`tests/sanitize.test.ts` runs whole inputs through `sanitize()` and is usually the place for new detection behaviour. The other suites test one module each.

- Use fictional data only. When a bug report or pasted example becomes a test, sample or doc, replace its real emails, usernames, paths and IDs first.
- Token- and key-shaped fixtures are built by string concatenation (`"gh" + "p_" + …`) so secret scanners don't flag the test files.

## Git and releases

- `main` is protected by a ruleset that rejects direct pushes, so every change needs a pull request.
- Merging to `main` deploys the site through `deploy.yml`. Pushing a `vX.Y.Z` tag only publishes a GitHub release through `release.yml`.
- Git tags carry the version. `package.json`'s `version` is not bumped when tagging.
