# Verity attestor

The witness that opens the TLS connection to a data source, verifies the client's
zero-knowledge proof of the response, and signs the resulting claim with its key.
Verifiers trust proofs signed by this attestor's address.

Built from [`reclaimprotocol/attestor-core`](https://github.com/reclaimprotocol/attestor-core)
pinned to commit `67eade1` (v5.0.7), run under our own signing key.

## Run locally

```bash
git clone https://github.com/reclaimprotocol/attestor-core.git
cd attestor-core && git checkout 67eade1f2436e071601fba00ef5e26917bab30c2
npm install --ignore-scripts
npm rebuild                 # builds the native re2 addon
npm run download:zk-files   # fetches the ZK circuits
PRIVATE_KEY=$(node -e "console.log(require('ethers').Wallet.createRandom().privateKey)")
PORT=8001 PRIVATE_KEY=$PRIVATE_KEY node --experimental-strip-types src/scripts/start-server.ts
```

The server listens on `ws://localhost:8001/ws`. Point the SDK at it via
`VERITY_ATTESTOR_URL=ws://localhost:8001/ws`.

Or with Docker:

```bash
docker build -t verity-attestor services/attestor
docker run -e PRIVATE_KEY=0x... -e PORT=8001 -p 8001:8001 verity-attestor
```

## Deploy on Railway

1. New Railway service → Deploy from this repo, root `services/attestor` (Dockerfile builder).
2. Set service Variables: `PRIVATE_KEY` (see `.env.example`), optionally `LOG_LEVEL`, `ZK_CONCURRENCY`.
   Railway sets `PORT` automatically.
3. Railway gives a public domain; clients connect at `wss://<domain>/ws`.

Record the attestor's **address** (printed on boot as `signerAddress`) — that is the
value verifiers and the on-chain verifier contract must trust.
