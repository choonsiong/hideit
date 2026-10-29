import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Injected only into production builds: Vite's dev server needs a websocket for HMR.
// connect-src 'none' guarantees the page can never send pasted data anywhere.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function cspPlugin(): Plugin {
  return {
    name: "hideit-csp",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

export default defineConfig({
  base: "./",
  plugins: [cspPlugin()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
