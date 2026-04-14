# Security

## Reporting issues

If you find a vulnerability, please report it privately to the repository maintainers (GitHub Security Advisories or direct message), not via public issues.

## Secrets and configuration

- **Never commit** `backend/.env`, `frontend/.env`, or any file containing real credentials, JWT secrets, or database URLs.
- The tracked files **`backend/.env.example`** and **`frontend/.env.example`** are templates only; they must not contain production secrets.
- Rotate **`AUTH_SECRET`** immediately if it was ever exposed or committed.
- **`KLIPY_API_KEY`** (if used) stays on the server; the browser talks to your backend proxy, not to Klipy with a key.

## Authentication

- Passwords are hashed with bcrypt; plaintext passwords are not stored.
- Sessions use HTTP-only cookies (`SameSite=None` + `Secure` in production for cross-origin SPAs; `SameSite=Lax` locally). The API also returns the JWT in JSON on login/signup/guest; the SPA may store it in `localStorage` and send `Authorization: Bearer` when cookies are blocked (e.g. some mobile browsers).
- JWTs are signed with `AUTH_SECRET`; in production the server refuses to start without it (see `getAuthSecret()` in `backend/src/auth/middleware.ts`).

## Transport and deployment

- Run the API and frontend over **HTTPS** in production so cookies and credentials are not sent in clear text.
- Configure **`CLIENT_ORIGIN`** to match your frontend origin exactly (scheme + host + port if non-default).
- Behind nginx, Caddy, Railway, Render, etc., enable **`TRUST_PROXY=1`** (or equivalent) so Express sees the real client IP for rate limiting.

## HTTP hardening

- **Helmet** sets standard security headers on the Express app (`backend/src/app.ts`). CSP is disabled because this service is primarily a JSON API.
- **Rate limiting** applies to `POST` routes under `/api/auth/*` to reduce brute-force and abuse (`backend/src/routes/auth.ts`).

## Dependency audits

Run periodically:

```bash
cd backend && npm audit
cd ../frontend && npm audit
```

Address high/critical issues before shipping to production.
