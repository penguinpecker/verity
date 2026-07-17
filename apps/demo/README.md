# Verity demo

A client-side app that proves a **real IPL cricket score** (from ESPN) with zkTLS and verifies
it on **Horizen mainnet** — real data, real proof, real on-chain check.

- The server (`server.js`) runs `@verity/sdk` and streams the real proof steps over SSE.
- The browser (`public/`) renders the pipeline and verifies the proof against the live
  `VerityVerifier` contract (`0xDe8b…faDd`) with ethers — a real on-chain read call.

## Architecture (Vercel + Railway)

The zkTLS prover uses native modules and takes ~25s, so it can't run on Vercel serverless.
So the split is:

- **Frontend → Vercel** (static `public/`). Calls the prover over CORS.
- **Prover API → Railway** (`Dockerfile`, Node). Exposes `/api/prove` (SSE) and `/api/current`.

`public/app.js` points at the Railway prover when not on localhost (override with
`window.VERITY_PROVER`).

## Run locally

```bash
npm install          # from the repo root (workspaces) or in this folder
npm run dev          # -> http://localhost:4000  (serves frontend + prover together)
```

Requires the SDK's dependencies installed (`packages/sdk`).
