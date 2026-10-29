# HideIt

A single-page app that replaces sensitive data (emails, passwords, tokens, API keys, IDs) with random values, so you can share logs, configs and commands safely in tickets, chats or LLM prompts.

**Everything runs in your browser.** Nothing you paste is sent anywhere or stored. The production build sets a Content Security Policy with `connect-src 'none'`, so the page can't make network requests even if it tried. Only your settings are saved in `localStorage`.

## Usage

```bash
npm install
npm run dev        # http://localhost:5173
```

Paste text on the left and the sanitized output appears on the right, with each replacement highlighted in its category's colour. Then:

- **Copy** copies the sanitized output.
- **Regenerate** picks new random values.
- The category chips switch detectors on and off.
- **Same value → same replacement** keeps relationships intact: a repeated email gets the same fake email everywhere.
- **Custom keys** (comma-separated) force the values of extra field names, such as `username` or `phone`, to be replaced.
- **Custom words** (comma-separated) are replaced wherever they appear, for example your username inside `/Users/<name>/…` paths. Each word always maps to the same random word (`alexkim` → `falcon`, keeping the case: `Alexkim` → `Falcon`). Matching is case-insensitive and whole-word, so `lee` won't touch `sleep`.

## What gets replaced

| Category | Detected via | Replacement |
|---|---|---|
| Emails | any email address, `email`/`*_email` keys | `<random>@example.com` |
| Passwords / secrets | `password`, `passwd`, `pwd`, `DB_PASS`, `*_secret`, `private_key`, `pin`, `otp` keys; `curl -u user:pass`; `scheme://user:pass@host` | random 16-character string (fixed length, so the real length isn't revealed) |
| Tokens / API keys | `token`, `*_token`, `api_key`, `X-Api-Key`, `Authorization`, `Cookie`, `session` keys; JWTs; `Bearer`/`Basic` credentials; GitHub, GitLab, OpenAI/Anthropic, Stripe, Slack, AWS, Google and npm token formats | same length and character classes; known prefixes (`ghp_`, `sk-ant-`, `AKIA`, `eyJ`…) and auth schemes are kept |
| IDs / UUIDs | `id`, `_id`, `user_id`, `userId`, `x-request-id`, `ssn`… keys; any UUID | UUID → new v4 UUID, number → random digits of the same length, other → same character classes |
| Private keys | PEM `-----BEGIN … PRIVATE KEY-----` blocks, including inside JSON strings | header and footer kept, body randomized |
| IPv4 addresses | any IPv4 except `127.*`, `0.0.0.0`, `255.*` | address in the documentation ranges `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` |
| Credit cards | 13–19 digit numbers with a card network prefix that pass the Luhn check | Luhn-valid random number, same network digit and separators |
| Custom words | words you list, anywhere in the text | the same random word every time, with the original's case |

Key/value pairs are recognized in JSON (including JSON embedded in JSON strings), YAML, `.env` files, HTTP headers, query strings, `--flag value` / `--flag=value`, `-Dprop=value`, Python/PHP/JS dictionaries and XML tags. Values in flat arrays (`"ids": [1, 2]`) are replaced too.

The text is edited in place, never parsed and re-serialized, so formatting, key order and comments stay exactly as they were. This also protects large numeric IDs, which `JSON.parse` would round (`1234567890123456789` → `…800`).

Values that aren't secrets are left alone: `null`/`true`/`false`, masks like `****` or `[REDACTED]`, references like `$DB_PASS`, `${TOKEN}` or `{{ .Values.x }}`, placeholders like `<your-key>`, file paths and URLs.

## Known limitations

- A secret with no recognizable key or format can't be detected, for example a bare password in prose. Add its key under **Custom keys**, or edit it by hand.
- Ambiguous short flags such as `-p` aren't treated as passwords, because `mkdir -p` and `docker -p 8080:80` are far more common than `mysql -psecret`.
- Unquoted values stop at whitespace. A YAML password containing spaces is only fully replaced when it's quoted.
- Names, phone numbers, addresses and hostnames aren't detected by default. Use **Custom keys** for fields like `username` or `phone`, and **Custom words** for specific names that appear anywhere.
- A custom word inside an email or a secret is replaced as part of that whole value, not by its pseudonym, so nothing around it is left behind.

Always review the output before sharing it.

## Development

```bash
npm test           # unit tests (Vitest)
npm run typecheck  # tsc --noEmit
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ at http://localhost:4173
```

`dist/` is a static site you can host anywhere (GitHub Pages, Cloudflare Pages, any web server). It must be served over HTTP(S): browsers don't load ES modules from `file://`.

### GitHub Pages

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to `main`. In the repository go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**. With "Deploy from a branch", Pages serves the unbuilt source `index.html`, which can't load `src/main.ts`, so you get an unstyled page that doesn't work. Asset paths are relative, so the site works under a sub-path such as `/hideit/`.

### Layout

```
src/
  main.ts              UI wiring (vanilla DOM, text nodes only, never innerHTML)
  sample.ts            "Load sample" text
  style.css            layout, light/dark themes, category colours
  sanitizer/
    index.ts           sanitize(input, options, { rng, memory }) → { output, findings }
    detectors.ts       key/value and pattern detectors → candidate spans; overlap resolution
    keys.ts            which key names are sensitive
    generators.ts      shape-preserving random replacements
    random.ts          crypto-backed RNG, plus a seeded RNG for tests
    types.ts
tests/                 Vitest suites
vite.config.ts         build-only plugin that injects the CSP meta tag
```

The sanitizer has no DOM dependency, so you can reuse it elsewhere, for example in a CLI.
