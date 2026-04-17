# unplyd

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

There is **no root `package.json`**; the Vite app is only under **`frontend/`**.

1. Create a Vercel project and connect this Git repository.
2. **Project → Settings → General → Root Directory** → set to **`frontend`** (required). Vercel will run `npm install` / `npm run build` from that folder and detect Vite.
3. SPA routing uses [`frontend/vercel.json`](./frontend/vercel.json) (rewrite to `index.html`).
4. In **Settings → Environment Variables** (Production / Preview), set:
   - **`VITE_API_URL`** — your backend base URL, e.g. `https://api.yourdomain.com` (use **HTTPS** in production).
   - **`VITE_SOCKET_URL`** — same host as Socket.IO (usually the same as the API origin).
5. Redeploy after changing env vars (`VITE_*` are baked in at build time).

**If the build still runs `cd frontend && npm ci`:** that text is **not** in this repo anymore — Vercel is using a **saved override**. Open **Project → Settings → Build and Development Settings** (or **General** on older UI) and **clear** the **Install Command** field (use the default / empty so [`frontend/vercel.json`](./frontend/vercel.json) applies), or set it to **`npm ci`** only (no `cd`). **Root Directory** must stay **`frontend`**. Save and redeploy.

### Backend is not on Vercel

The **Express + Socket.IO** server needs a **long‑running** Node host (Railway, Render, Fly.io, a VPS, etc.). Vercel serverless is not a drop‑in replacement for persistent WebSockets.

On that host, set **`CLIENT_ORIGIN`** to your Vercel URL (e.g. `https://your-app.vercel.app` or your custom domain) so CORS and cookies work. **`TRUST_PROXY=1`** if the app sits behind their load balancer.

Preview deployments get a different `*.vercel.app` URL; your backend CORS must allow that origin too, or use a separate preview API / env.

### Backend on Render

Do **not** use `npm run dev` in production — it runs **nodemon**, which is a **devDependency** and is not installed on Render (`nodemon: not found`).

In the Render service **Settings → Build & Deploy**, set **Start Command** to exactly **`npm start`** (not `npm run dev`). If you leave an old value, Render keeps using it until you change it.

| Field | Value |
| ----- | ----- |
| **Root Directory** | `backend` |
| **Build Command** | `npm install --include=dev && npm run build` |
| **Start Command** | `npm start` |

`npm start` runs `node dist/index.js`. Set **`NODE_ENV=production`**, **`DATABASE_URL`**, **`AUTH_SECRET`**, **`CLIENT_ORIGIN`**, **`TRUST_PROXY=1`**, etc. in **Environment** (`PORT` is set by Render).

If **Root Directory** is empty (repo root), use the root [`package.json`](./package.json): **Build** `npm run build`, **Start** `npm start`.

See [`backend/README.md`](./backend/README.md) for the same checklist. You can also use [`render.yaml`](./render.yaml) as a Blueprint (adjust name/region/plan as needed).

## License

Private project unless you add a public license.
