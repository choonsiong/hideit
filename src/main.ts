import "./style.css";
import {
  CATEGORY_LABELS,
  TOGGLEABLE_CATEGORIES,
  countByCategory,
  defaultOptions,
  sanitize,
  type Category,
  type Finding,
  type SanitizeOptions,
} from "./sanitizer";
import { SAMPLE } from "./sample";

const SETTINGS_KEY = "hideit:settings";
const DEBOUNCE_MS = 150;
// Live typing keeps adding partial values to the memory; start over if it grows too large.
const MEMORY_LIMIT = 10_000;

const NOUNS: Record<Category, [singular: string, plural: string]> = {
  email: ["email", "emails"],
  secret: ["password/secret", "passwords/secrets"],
  token: ["token", "tokens"],
  id: ["ID", "IDs"],
  privateKey: ["private key", "private keys"],
  ip: ["IP address", "IP addresses"],
  card: ["card number", "card numbers"],
  custom: ["custom value", "custom values"],
};

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const inputEl = byId<HTMLTextAreaElement>("input");
const outputEl = byId<HTMLPreElement>("output");
const summaryEl = byId<HTMLParagraphElement>("summary");
const categoriesEl = byId<HTMLDivElement>("categories");
const consistentEl = byId<HTMLInputElement>("consistent");
const extraKeysEl = byId<HTMLInputElement>("extra-keys");
const toastEl = byId<HTMLDivElement>("toast");

/** Only settings are persisted, never the input. */
function loadOptions(): SanitizeOptions {
  const defaults = defaultOptions();
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<SanitizeOptions>;
    return {
      categories: { ...defaults.categories, ...saved.categories },
      consistent: typeof saved.consistent === "boolean" ? saved.consistent : defaults.consistent,
      extraKeys: Array.isArray(saved.extraKeys) ? saved.extraKeys.filter((k) => typeof k === "string") : [],
    };
  } catch {
    return defaults;
  }
}

function saveOptions(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(options));
  } catch {
    // Storage can be unavailable (private mode, disabled cookies); settings just won't persist.
  }
}

const options = loadOptions();
let memory = new Map<string, string>();
let output = "";

function renderOutput(text: string, findings: readonly Finding[]): void {
  // Text nodes only: pasted input must never be interpreted as HTML.
  const fragment = document.createDocumentFragment();
  let pos = 0;
  for (const finding of findings) {
    fragment.append(text.slice(pos, finding.start));
    const mark = document.createElement("mark");
    mark.className = `cat-${finding.category}`;
    mark.title = CATEGORY_LABELS[finding.category];
    mark.textContent = text.slice(finding.start, finding.end);
    fragment.append(mark);
    pos = finding.end;
  }
  fragment.append(text.slice(pos));
  outputEl.replaceChildren(fragment);
}

function renderSummary(findings: readonly Finding[]): void {
  if (!inputEl.value) {
    summaryEl.textContent = "Paste something on the left to get started.";
    return;
  }
  if (findings.length === 0) {
    summaryEl.textContent = "Nothing sensitive found.";
    return;
  }
  const parts = [...countByCategory(findings)].map(([category, count]) => {
    const [singular, plural] = NOUNS[category];
    return `${count} ${count === 1 ? singular : plural}`;
  });
  summaryEl.textContent = `Replaced ${parts.join(" · ")}`;
}

function run(): void {
  if (memory.size > MEMORY_LIMIT) memory = new Map();
  const result = sanitize(inputEl.value, options, { memory });
  output = result.output;
  renderOutput(result.output, result.findings);
  renderSummary(result.findings);
}

let debounceTimer: number | undefined;
function runSoon(): void {
  window.clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(run, DEBOUNCE_MS);
}

let toastTimer: number | undefined;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1600);
}

function selectOutput(): void {
  const range = document.createRange();
  range.selectNodeContents(outputEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

async function copyOutput(): Promise<void> {
  if (!output) {
    toast("Nothing to copy yet");
    return;
  }
  try {
    await navigator.clipboard.writeText(output);
    toast("Copied sanitized output");
  } catch {
    selectOutput();
    toast("Clipboard unavailable: output selected, press Ctrl+C / ⌘C");
  }
}

function renderOptions(): void {
  for (const category of TOGGLEABLE_CATEGORIES) {
    const label = document.createElement("label");
    label.className = `chip cat-${category}`;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = options.categories[category];
    checkbox.addEventListener("change", () => {
      options.categories[category] = checkbox.checked;
      saveOptions();
      run();
    });
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    label.append(checkbox, dot, CATEGORY_LABELS[category]);
    categoriesEl.append(label);
  }

  consistentEl.checked = options.consistent;
  consistentEl.addEventListener("change", () => {
    options.consistent = consistentEl.checked;
    memory = new Map();
    saveOptions();
    run();
  });

  extraKeysEl.value = options.extraKeys.join(", ");
  extraKeysEl.addEventListener("input", () => {
    options.extraKeys = extraKeysEl.value
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    saveOptions();
    runSoon();
  });
}

inputEl.addEventListener("input", runSoon);
byId("copy").addEventListener("click", () => void copyOutput());
byId("regenerate").addEventListener("click", () => {
  memory = new Map();
  run();
  toast("New random values generated");
});
byId("clear").addEventListener("click", () => {
  inputEl.value = "";
  memory = new Map();
  run();
  inputEl.focus();
});
byId("sample").addEventListener("click", () => {
  inputEl.value = SAMPLE;
  memory = new Map();
  run();
});

renderOptions();
run();
inputEl.focus();
