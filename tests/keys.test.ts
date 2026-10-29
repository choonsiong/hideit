import { describe, expect, it } from "vitest";
import { keyCategory } from "../src/sanitizer/keys";

describe("keyCategory", () => {
  it.each([
    ["password", "secret"],
    ["DB_PASSWORD", "secret"],
    ["dbPassword", "secret"],
    ["passwd", "secret"],
    ["pwd", "secret"],
    ["DB_PASS", "secret"],
    ["client_secret", "secret"],
    ["private_key", "secret"],
    ["pin", "secret"],
    ["token", "token"],
    ["access_token", "token"],
    ["refreshToken", "token"],
    ["api_key", "token"],
    ["X-Api-Key", "token"],
    ["Authorization", "token"],
    ["Cookie", "token"],
    ["session_id", "token"],
    ["email", "email"],
    ["userEmail", "email"],
    ["EMAIL_ADDRESS", "email"],
    ["id", "id"],
    ["_id", "id"],
    ["user_id", "id"],
    ["userId", "id"],
    ["userID", "id"],
    ["USERID", "id"],
    ["x-request-id", "id"],
    ["uuid", "id"],
    ["user_ids", "id"],
    ["ssn", "id"],
  ])("%s → %s", (key, expected) => {
    expect(keyCategory(key)).toBe(expected);
  });

  it.each(["valid", "paid", "android", "grid", "name", "type", "key", "token_type", "status", "bypass", "compass", "description"])(
    "%s is not sensitive",
    (key) => {
      expect(keyCategory(key)).toBeNull();
    },
  );

  it("matches custom keys after normalizing case and separators", () => {
    expect(keyCategory("Customer-Name", new Set(["customername"]))).toBe("custom");
    expect(keyCategory("customer_name")).toBeNull();
  });
});
