# Backend API

## Render (fix `nodemon: not found`)

Render must **not** run `npm run dev` — that uses **nodemon** (dev-only).

**Settings → Build & Deploy:**

| Field | Value |
| ----- | ----- |
| **Root Directory** | `backend` |
| **Build Command** | `npm install --include=dev && npm run build` |
| **Start Command** | `npm start` |

`npm start` runs `node dist/index.js` (see `package.json`).

If **Start Command** is still `npm run dev`, change it in the dashboard, save, and redeploy.

---

If you deploy from the **repository root** (Root Directory empty), use the root `package.json` in the parent folder: **Build** `npm run build`, **Start** `npm start`.
