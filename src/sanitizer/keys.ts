import type { Category } from "./types";

/** Lowercase and drop separators, so "DB_PASSWORD", "db-password" and "dbPassword" compare equal. */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_.\s]/g, "");
}

const EMAIL_EXACT = new Set(["mail"]);
const EMAIL_SUFFIXES = ["email", "emails", "emailaddress", "mailaddress"];

const SECRET_EXACT = new Set(["pass", "pwd", "pw", "pin", "otp", "credential", "credentials"]);
const SECRET_CONTAINS = ["password", "passwd", "passphrase", "passcode"];
const SECRET_SUFFIXES = ["secret", "privatekey", "secretkey"];
// "DB_PASS", "dbPwd". Requires a separator or camelCase so "bypass" and "compass" don't match.
const SECRET_SEPARATED_RE = /[-_.\s](?:pass|pwd|pw)$/i;
const SECRET_CAMEL_RE = /[a-z0-9](?:Pass|Pwd|PW)$/;

const TOKEN_EXACT = new Set([
  "auth", "authorization", "proxyauthorization", "bearer", "session", "sid",
  "cookie", "setcookie", "sig", "csrf", "xsrf", "jwt",
]);
const TOKEN_SUFFIXES = ["token", "tokens", "apikey", "apikeys", "accesskey", "sessionid", "signature"];

const ID_EXACT = new Set(["id", "ids", "uid", "uids", "uuid", "uuids", "guid", "guids", "ssn"]);
// Separator or camelCase before the suffix, so "valid", "paid" and "android" don't match.
const ID_SEPARATED_RE = /[-_.\s](?:id|uid|uuid|guid)s?$/i;
const ID_CAMEL_RE = /[a-z0-9](?:Id|ID|Uid|UID|Uuid|UUID|Guid|GUID)s?$/;
// All-lowercase or all-uppercase forms such as "userid" / "USERID".
const ID_PREFIXED_RE =
  /^(?:user|account|customer|client|device|order|member|tenant|org|organization|project|employee|profile|request|trace|transaction|txn|correlation|merchant|owner|patient|payment|invoice|subscription|contact|person|player|vendor)(?:id|uid|uuid|guid)s?$/;

/** Which kind of sensitive value a key holds, or null if the key isn't sensitive. */
export function keyCategory(key: string, customKeys: ReadonlySet<string> = new Set()): Category | null {
  const norm = normalizeKey(key);
  if (!norm) return null;
  if (customKeys.has(norm)) return "custom";

  if (EMAIL_EXACT.has(norm) || EMAIL_SUFFIXES.some((s) => norm.endsWith(s))) return "email";

  if (
    SECRET_EXACT.has(norm) ||
    SECRET_CONTAINS.some((s) => norm.includes(s)) ||
    SECRET_SUFFIXES.some((s) => norm.endsWith(s)) ||
    SECRET_SEPARATED_RE.test(key) ||
    SECRET_CAMEL_RE.test(key)
  ) {
    return "secret";
  }

  if (TOKEN_EXACT.has(norm) || TOKEN_SUFFIXES.some((s) => norm.endsWith(s))) return "token";

  if (ID_EXACT.has(norm) || ID_SEPARATED_RE.test(key) || ID_CAMEL_RE.test(key) || ID_PREFIXED_RE.test(norm)) {
    return "id";
  }

  return null;
}
