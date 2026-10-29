import { describe, expect, it } from "vitest";
import { defaultOptions, sanitize, type SanitizeOptions } from "../src/sanitizer";
import { luhnValid } from "../src/sanitizer/generators";
import { createSeededRng } from "../src/sanitizer/random";

// Built at runtime so secret scanners don't flag the test file.
const GITHUB_TOKEN = "gh" + "p_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const PEM_BEGIN = "-----BEGIN " + "PRIVATE KEY-----";
const PEM_END = "-----END " + "PRIVATE KEY-----";

function run(input: string, overrides: Partial<SanitizeOptions> = {}, seed = 42) {
  return sanitize(input, { ...defaultOptions(), ...overrides }, { rng: createSeededRng(seed) });
}

const replaced = (input: string, overrides?: Partial<SanitizeOptions>) => {
  const { output, findings } = run(input, overrides);
  return findings.map((f) => ({ category: f.category, value: output.slice(f.start, f.end) }));
};

describe("JSON", () => {
  const input = `{
  "id": 1234567890123456789,
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john.doe@acme.io",
  "password": "hunter2",
  "api_key": "${GITHUB_TOKEN}",
  "name": "John",
  "valid": true,
  "paid": 100,
  "ids": [12, 34],
  "token": null
}`;

  it("stays valid JSON with the same layout", () => {
    const { output } = run(input);
    const before = JSON.parse(input);
    const after = JSON.parse(output);
    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(output.split("\n").map((l) => l.match(/^\s*/)![0])).toEqual(input.split("\n").map((l) => l.match(/^\s*/)![0]));
  });

  it("replaces sensitive values and keeps the rest", () => {
    const { output } = run(input);
    const after = JSON.parse(output);
    expect(after.user_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    expect(after.user_id).not.toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(after.email).toMatch(/^[a-z]{8}@example\.com$/);
    expect(after.password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(after.api_key).toMatch(/^ghp_[A-Za-z0-9]{36}$/);
    expect(after.api_key).not.toBe(GITHUB_TOKEN);
    expect(after.ids).toHaveLength(2);
    expect(after.ids).not.toEqual([12, 34]);
    expect(after).toMatchObject({ name: "John", valid: true, paid: 100, token: null });
  });

  it("keeps all 19 digits of a large numeric ID (JSON.parse would round it)", () => {
    const id = run(input).output.match(/"id": (\d+)/)![1]!;
    expect(id).toHaveLength(19);
    expect(id).not.toBe("1234567890123456789");
  });

  it("handles JSON embedded in a JSON string", () => {
    const { output } = run(String.raw`{"body": "{\"password\": \"abc\", \"note\": \"hi\"}"}`);
    const inner = JSON.parse(JSON.parse(output).body);
    expect(inner.password).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(inner.note).toBe("hi");
  });

  it("keeps a service-account key file parseable", () => {
    const keyFile = JSON.stringify({
      type: "service_account",
      private_key_id: "abcdef1234567890",
      private_key: `${PEM_BEGIN}\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nBKcwggSjAgEAAoIBAQC7\n${PEM_END}\n`,
      client_email: "svc@proj.iam.gserviceaccount.com",
    });
    const after = JSON.parse(run(keyFile).output);
    expect(after.type).toBe("service_account");
    expect(after.private_key.startsWith(`${PEM_BEGIN}\n`)).toBe(true);
    expect(after.private_key.endsWith(`\n${PEM_END}\n`)).toBe(true);
    expect(after.private_key).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASC");
    expect(after.client_email).toMatch(/@example\.com$/);
    expect(after.private_key_id).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("other formats", () => {
  it(".env files", () => {
    const { output } = run("DB_PASSWORD=supersecret\nAPI_TOKEN=\"tok_12345678\"\nREF=$DB_PASS\nPWD=/Users/me\nDEBUG=true\n");
    const lines = output.split("\n");
    expect(lines[0]).toMatch(/^DB_PASSWORD=[A-Za-z0-9]{16}$/);
    expect(lines[1]).toMatch(/^API_TOKEN="[a-z]{3}_\d{8}"$/);
    expect(lines[1]).not.toBe('API_TOKEN="tok_12345678"');
    expect(lines.slice(2)).toEqual(["REF=$DB_PASS", "PWD=/Users/me", "DEBUG=true", ""]);
  });

  it("curl commands", () => {
    const cmd = `curl -H "Authorization: Bearer ${JWT}" -u admin:s3cret 'https://bob:pa55w0rd@api.example.com/v1?token=abc123xyz&page=2'`;
    const { output } = run(cmd);
    expect(output).toMatch(/^curl -H "Authorization: Bearer eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+" -u admin:[A-Za-z0-9]{16} /);
    expect(output).not.toContain(JWT);
    expect(output).toMatch(/'https:\/\/bob:[A-Za-z0-9]{16}@api\.example\.com\/v1\?token=[a-z0-9]{9}&page=2'$/);
    expect(output).not.toContain("abc123xyz");
  });

  it("CLI flags", () => {
    const { output } = run("mysql --password hunter2 --user root && docker login --password-stdin && java -Ddb.password=jvm -jar app.jar");
    expect(output).toMatch(/^mysql --password [A-Za-z0-9]{16} --user root && docker login --password-stdin && java -Ddb\.password=[A-Za-z0-9]{16} -jar app\.jar$/);
  });

  it("does not treat uid:gid as curl credentials", () => {
    expect(run("docker run -u 1000:1000 alpine").output).toBe("docker run -u 1000:1000 alpine");
  });

  it("YAML, without breaking nested blocks", () => {
    const yaml = "auth:\n  user: bob\n  password: 'p@ss w0rd'\n  userId: 42\n  android: phone\n";
    const lines = run(yaml).output.split("\n");
    expect(lines[0]).toBe("auth:");
    expect(lines[1]).toBe("  user: bob");
    expect(lines[2]).toMatch(/^ {2}password: '[A-Za-z0-9]{16}'$/);
    expect(lines[3]).toMatch(/^ {2}userId: [1-9]\d$/);
    expect(lines[4]).toBe("  android: phone");
  });

  it("XML and Python/PHP style dictionaries", () => {
    const { output } = run("<password>xmlSecret1</password><name>bob</name>\n{'password': 'py'}\n['token' => 'phpTok3n']");
    expect(output).toMatch(/^<password>[A-Za-z0-9]{16}<\/password><name>bob<\/name>\n\{'password': '[A-Za-z0-9]{16}'\}\n\['token' => '[a-z]{3}[A-Z][a-z]{2}\d[a-z]'\]$/);
  });

  it("cookies: values that look like tokens, not preferences or attributes", () => {
    const { output } = run("Cookie: session=abc123; theme=dark\nSet-Cookie: tracker=8f3a9c2e41; Path=/; HttpOnly");
    expect(output).toMatch(/^Cookie: session=[a-z0-9]{6}; theme=dark\nSet-Cookie: tracker=[0-9a-f]{10}; Path=\/; HttpOnly$/);
    expect(output).not.toContain("abc123");
    expect(output).not.toContain("8f3a9c2e41");
  });

  it("multi-line PEM private keys keep header, footer and line lengths", () => {
    const body = ["MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7", "abcDEF123+/="];
    const { output } = run(`${PEM_BEGIN}\n${body.join("\n")}\n${PEM_END}`);
    const lines = output.split("\n");
    expect(lines[0]).toBe(PEM_BEGIN);
    expect(lines.at(-1)).toBe(PEM_END);
    expect(lines.slice(1, -1).map((l) => l.length)).toEqual(body.map((l) => l.length));
    expect(lines[1]).not.toBe(body[0]);
    expect(lines[2]).toMatch(/\+\/=$/);
  });
});

describe("values found anywhere", () => {
  it("emails, tokens, JWTs and UUIDs in free text", () => {
    const text = `Contact jane@corp.com. Key ${GITHUB_TOKEN}, jwt ${JWT}, request 550e8400-e29b-41d4-a716-446655440000.`;
    expect(replaced(text).map((r) => r.category)).toEqual(["email", "token", "token", "id"]);
    expect(run(text).output).toMatch(/^Contact [a-z]{8}@example\.com\. Key ghp_\w{36}, jwt eyJ\S+, request [0-9a-f-]{36}\.$/);
  });

  it("IPv4 addresses become documentation addresses; loopback is kept", () => {
    const { output } = run("from 10.1.2.3 and 192.168.0.10 to 127.0.0.1 on 0.0.0.0");
    expect(output).toMatch(/^from (?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+ and (?:192\.0\.2|198\.51\.100|203\.0\.113)\.\d+ to 127\.0\.0\.1 on 0\.0\.0\.0$/);
  });

  it("credit cards are replaced with Luhn-valid numbers; other long numbers are kept", () => {
    const { output, findings } = run("card 4111 1111 1111 1111, ts 1730246400000, order 1234567890123456");
    expect(findings).toHaveLength(1);
    const card = output.match(/card ([\d ]+),/)![1]!;
    expect(card).toMatch(/^4\d{3} \d{4} \d{4} \d{4}$/);
    expect(card).not.toBe("4111 1111 1111 1111");
    expect(luhnValid(card.replace(/ /g, ""))).toBe(true);
    expect(output).toContain("ts 1730246400000, order 1234567890123456");
  });

  it("leaves ordinary text alone", () => {
    const text =
      "The quick brown fox, version 1.2.3, uses Bearer authentication.\nvalid: true\npaid: 100\nstatus=ok\ntoken: null\npassword: ****\nsecret: ${SECRET}\napi_key: <your-api-key>\n";
    expect(run(text).output).toBe(text);
  });
});

describe("options", () => {
  const text = 'email=a@b.com password=hunter2 ip=10.0.0.1 "customer_name": "Alice"';

  it("disabled categories are kept", () => {
    const categories = { ...defaultOptions().categories, email: false, ip: false };
    const { output } = run(text, { categories });
    expect(output).toContain("email=a@b.com");
    expect(output).toContain("ip=10.0.0.1");
    expect(output).not.toContain("hunter2");
  });

  it("custom keys are always replaced", () => {
    const { output } = run(text, { extraKeys: ["Customer Name"] });
    expect(output).toMatch(/"customer_name": "[A-Z][a-z]{4}"/);
    expect(output).not.toContain("Alice");
  });

  it("consistent mode maps the same value to the same replacement", () => {
    const input = "from a@b.com to c@d.com cc a@b.com";
    const values = replaced(input).map((r) => r.value);
    expect(values[0]).toBe(values[2]);
    expect(values[0]).not.toBe(values[1]);
  });

  it("without consistent mode every occurrence gets its own value", () => {
    const values = replaced("a@b.com a@b.com", { consistent: false }).map((r) => r.value);
    expect(values[0]).not.toBe(values[1]);
  });

  it("a shared memory keeps replacements stable across calls", () => {
    const memory = new Map<string, string>();
    const first = sanitize("x a@b.com", defaultOptions(), { memory }).output;
    const second = sanitize("y a@b.com", defaultOptions(), { memory }).output;
    expect(first.slice(2)).toBe(second.slice(2));
  });
});

describe("result", () => {
  const input = `{"email": "john@acme.io", "token": "${GITHUB_TOKEN}"} 10.0.0.1 hunter2@x.org`;

  it("findings point at the replacements in the output, which never equal the originals", () => {
    const { output, findings } = run(input);
    expect(findings.length).toBe(4);
    for (const f of findings) {
      const value = output.slice(f.start, f.end);
      expect(value.length).toBeGreaterThan(0);
      expect(input).not.toContain(value);
    }
  });

  it("is deterministic for a given RNG seed", () => {
    expect(run(input, {}, 1).output).toBe(run(input, {}, 1).output);
    expect(run(input, {}, 1).output).not.toBe(run(input, {}, 2).output);
  });
});
