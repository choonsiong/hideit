export type Category = "email" | "secret" | "token" | "id" | "privateKey" | "ip" | "card" | "custom";

/** Categories the user can switch on and off. "custom" is enabled by listing custom keys. */
export const TOGGLEABLE_CATEGORIES = ["email", "secret", "token", "id", "privateKey", "ip", "card"] as const;
export type ToggleableCategory = (typeof TOGGLEABLE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  email: "Emails",
  secret: "Passwords / secrets",
  token: "Tokens / API keys",
  id: "IDs / UUIDs",
  privateKey: "Private keys",
  ip: "IPv4 addresses",
  card: "Credit cards",
  custom: "Custom keys",
};

export interface SanitizeOptions {
  categories: Record<ToggleableCategory, boolean>;
  /** Same original value → same replacement everywhere in the output. */
  consistent: boolean;
  /** Extra key names whose values are always replaced. */
  extraKeys: string[];
}

/**
 * How a span's replacement is generated.
 * "key" spans were found through a sensitive key name, so the generator inspects the value's shape.
 */
export type SpanKind = "key" | "email" | "token" | "uuid" | "pem" | "ip" | "card" | "password";

export interface Span {
  start: number;
  end: number;
  category: Category;
  kind: SpanKind;
  priority: number;
}

export interface Finding {
  category: Category;
  /** Offsets into the sanitized output. */
  start: number;
  end: number;
}

export interface SanitizeResult {
  output: string;
  findings: Finding[];
}

export function defaultOptions(): SanitizeOptions {
  return {
    categories: { email: true, secret: true, token: true, id: true, privateKey: true, ip: true, card: true },
    consistent: true,
    extraKeys: [],
  };
}
