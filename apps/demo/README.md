# Verity demo

A client-side app that proves a **live ETH price from Kraken** with zkTLS and verifies it on
**Horizen mainnet** — real data, real proof, real on-chain check.

- The server (`server.js`) runs `@verity/sdk` and streams the real proof steps over SSE.
- The browser (`public/`) renders the pipeline and verifies the proof against the live
  `VerityVerifier` contract (`0xDe8b…faDd`) with ethers — a real on-chain read call.

## Run

```bash
npm install          # from the repo root (workspaces) or in this folder
npm run dev          # -> http://localhost:4000
```

Requires the SDK's dependencies installed (`packages/sdk`). Proving runs on the Node server
(the zkTLS prover uses native modules), so this runs locally / on a Node host, not on
serverless. It points at the hosted attestor and the mainnet contract by default.
