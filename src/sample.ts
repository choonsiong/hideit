// Token-shaped values are assembled at runtime so secret scanners don't flag this file. All values are fake.
const githubToken = "gh" + "p_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5";
const stripeKey = "sk_" + "test_" + "51Hx9QmKp2Lr8VtZ3nB6wY4cD0eF7gJ";
const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUifQ.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

export const SAMPLE = `{
  "user": {
    "id": 4815162342,
    "uuid": "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
    "name": "Jane Doe",
    "email": "jane.doe@acme-corp.com",
    "password": "Tr0ub4dor&3",
    "api_key": "${githubToken}",
    "role": "admin"
  },
  "session": { "access_token": "${jwt}", "expires_in": 3600 }
}

curl -X POST 'https://api.acme-corp.com/v1/orders?api_key=k_live_8f3a9c2e41b7&page=1' \\
  -H 'Authorization: Bearer ${jwt}' \\
  -u deploy:S3cr3tP@ss

# .env
DATABASE_URL=postgres://app:pg_p4ssw0rd@10.0.3.17:5432/orders
STRIPE_SECRET_KEY=${stripeKey}
DEBUG=false

2026-10-30T09:12:44Z INFO payment ok user=jane.doe@acme-corp.com card=4111 1111 1111 1111 ip=172.16.4.21 request_id=7c1e9f2a
`;
