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

## Deploying the frontend (Vercel)

This repo has **no root `package.json`**. The Vite app lives in **`frontend/`**.

### Option A — Import the repo (recommended)

1. Create a Vercel project and connect this Git repository.
2. Leave the project root at the **repository root** (default). The root [`vercel.json`](./vercel.json) installs and builds from `frontend/` and publishes `frontend/dist`.
3. In **Vercel → Settings → Environment Variables** (Production / Preview), set:
   - **`VITE_API_URL`** — your backend base URL, e.g. `https://api.yourdomain.com` (must be **HTTPS** in production).
   - **`VITE_SOCKET_URL`** — same host as Socket.IO (usually the same as the API origin).
4. Redeploy after changing env vars (they are baked in at build time for `VITE_*`).

### Option B — Root directory = `frontend`

In the Vercel project, set **Root Directory** to `frontend`. Vercel will auto-detect Vite; [`frontend/vercel.json`](./frontend/vercel.json) adds SPA **fallback** so client-side routes work. You still must set **`VITE_API_URL`** and **`VITE_SOCKET_URL`** as above.

### Backend is not on Vercel

The **Express + Socket.IO** server needs a **long‑running** Node host (Railway, Render, Fly.io, a VPS, etc.). Vercel serverless is not a drop‑in replacement for persistent WebSockets.

On that host, set **`CLIENT_ORIGIN`** to your Vercel URL (e.g. `https://your-app.vercel.app` or your custom domain) so CORS and cookies work. **`TRUST_PROXY=1`** if the app sits behind their load balancer.

Preview deployments get a different `*.vercel.app` URL; your backend CORS must allow that origin too, or use a separate preview API / env.

## License

Private project unless you add a public license.
