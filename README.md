# Gamemaxxing

Real-time party games (drawing, meme battle) with rooms, Socket.IO, and optional accounts.

## Repository layout

| Path        | Role                                      |
| ----------- | ----------------------------------------- |
| `frontend/` | React + Vite + Tailwind                   |
| `backend/`  | Express + Socket.IO + PostgreSQL + JWT auth |

## Prerequisites

- Node.js 20+
- PostgreSQL (or a hosted URL such as Neon)

## Quick start (development)

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set DATABASE_URL and AUTH_SECRET (see .env.example comments)
npm install
npm run dev
```

HTTP and Socket.IO listen on `PORT` (default `3000`). Health checks: `GET /health`, `GET /health/db`.

### Frontend

```bash
cd frontend
cp .env.example .env
# Point VITE_API_URL and VITE_SOCKET_URL at your backend (see frontend/.env.example)
npm install
npm run dev
```

## Production checklist

- Set `NODE_ENV=production`.
- Set a strong `AUTH_SECRET` (e.g. `openssl rand -hex 32`).
- Set `CLIENT_ORIGIN` to your real SPA origin (CORS + cookies).
- Use HTTPS; auth cookies use `secure: true` in production.
- If the app sits behind a reverse proxy, set `TRUST_PROXY=1` so rate limits and IPs are correct.
- Never commit `.env` files; only use `.env.example` as a template.

See [SECURITY.md](./SECURITY.md) for more detail.

## License

Private project unless you add a public license.
