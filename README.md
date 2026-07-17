# Verity

**Prove real data from any HTTPS endpoint, and let anyone verify it — without exposing the data or your credentials.**

Verity uses **zkTLS**: your app fetches a URL through a *Verity attestor* (a witness), generates a zero-knowledge proof that the response contained a specific value, and the attestor signs it. You reveal only the value you choose; the session keys, cookies, and any secret API keys never leave the client. The signed proof can be checked by anyone — in your backend, or on the Horizen (ZEN) appchain.

```
your app ──fetch through──▶ Verity attestor ──TLS──▶ data source (e.g. an API)
        ◀── signed proof ──                ◀── response ──
        "the response's `price` field was 64213.50, signed by attestor 0xce92…"
```

---

## Quickstart

The SDK talks to a **hosted Verity attestor by default** — no setup needed to try it. (Run your own for production; see [Run an attestor](#run-an-attestor).)

```js
import { VerityClient } from '@verity/sdk'

const verity = new VerityClient() // uses the hosted attestor; pass { attestorUrl } to self-host

// Prove a value from a live API. The named regex group becomes proof.data.
const proof = await verity.prove({
  url: 'https://api.wheretheiss.at/v1/satellites/25544',
  match: '"latitude":(?<latitude>-?[0-9.]+)',
})

console.log(proof.data)              // { latitude: '51.19...' }  ← proven from the live API
console.log(await verity.verify(proof))   // true

await verity.close()
```

That's the whole loop: **fetch → prove → verify.** Everything else below is detail.

---

## Install

The SDK is `@verity/sdk` in this monorepo (`packages/sdk`). An npm release is planned; until then, add it as a git or workspace dependency:

```bash
# inside this repo
npm install            # workspaces installs @verity/sdk

# from another project (temporary, until published)
npm install github:penguinpecker/verity#main
```

**Requirements:** Node **≥ 22** (the attestor and SDK use Node's native TLS/crypto), and access to a Verity attestor URL.

---

## How integration works (3 things to know)

1. **The attestor URL** is the one piece of infrastructure. Run your own (see below) and point the SDK at it. Its signing **address** is the identity your verifiers trust.
2. **`match` is a regex** applied to the *raw* HTTP response. Its **named groups** (`(?<name>...)`) are what get proven and returned in `proof.data`. Only the matched region is revealed.
3. **Secrets stay hidden.** Anything you put in `secretParams` (an API key, an `Authorization` header, a cookie) is used to make the request but is **redacted from the proof** — the verifier never sees it.

---

## API reference

### `new VerityClient(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `attestorUrl` | `string` | hosted attestor (or `VERITY_ATTESTOR_URL`) | ws/wss URL of your Verity attestor. |
| `appKey` | `string` | random | 0x-prefixed private key identifying your app (the claim "owner"). Persist one to keep a stable identity. |
| `zkEngine` | `string` | `'stwo'` | `'stwo'` (works everywhere) \| `'gnark'` (Linux, faster) \| `'snarkjs'`. |
| `trustedAttestors` | `string[]` | `[]` | Attestor addresses to accept in `verify()`. **Set this in production.** |

### `verity.prove(request) → Promise<VerityProof>`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | — | The HTTPS endpoint to prove (required). |
| `method` | `string` | `'GET'` | `GET` \| `POST` \| `PUT`. |
| `headers` | `object` | `{}` | Public request headers (visible in the proof). |
| `match` | `string` | — | Regex with named groups → becomes `proof.data`. |
| `matches` | `array` | — | Advanced: explicit `responseMatches` (instead of `match`). |
| `redactions` | `array` | — | Advanced: explicit `responseRedactions`. |
| `secretParams` | `object` | `{ headers: {} }` | Secret headers/cookies, **redacted from the proof** (e.g. `{ headers: { Authorization: 'Bearer …' } }`). |
| `onStep` | `function` | — | Progress callback (`connecting`, `generating-zk-proofs`, …). |

Returns a **`VerityProof`**:

```ts
{
  data: Record<string, string>   // the revealed, proven values (your regex groups)
  attestor: string               // signer address
  identifier: string             // claim hash
  claim: object                  // raw claim data
  signatures: object             // attestor signatures
  raw: object                    // full response (pass this to verifyProof)
}
```

### `verity.verify(proof) → Promise<boolean>`
Checks the attestor signature is valid and, if `trustedAttestors` was set, that the signer is one of them.

### `verifyProof(proof, { trustedAttestors }) → Promise<boolean>`
Standalone verifier (no client) — use it in a backend that receives proofs from clients.

### `verity.close() → Promise<void>`
Closes the attestor connection so your process can exit.

---

## Recipes

### Prove a value from a public API
```js
const proof = await verity.prove({
  url: 'https://api.example.com/v1/price?symbol=ETH',
  match: '"price":(?<price>[0-9.]+)',
})
proof.data.price   // "3421.55"
```

### Prove data behind a private API key (key stays hidden)
```js
const proof = await verity.prove({
  url: 'https://api.example.com/me/balance',
  match: '"balance":(?<balance>[0-9.]+)',
  secretParams: { headers: { Authorization: `Bearer ${process.env.API_KEY}` } },
})
// proof shows the balance; the API key is redacted and never appears in the proof.
```

### Verify safely in your backend (pin your attestor)
```js
import { verifyProof } from '@verity/sdk'

const ok = await verifyProof(proofFromClient, {
  trustedAttestors: ['0x710fc3548ed4f77a8cffa179639866798deb8bd1'], // your attestor address
})
if (!ok) throw new Error('invalid or untrusted proof')
```

### Multiple fields at once
```js
const proof = await verity.prove({
  url: 'https://api.wheretheiss.at/v1/satellites/25544',
  match: '"latitude":(?<lat>-?[0-9.]+),"longitude":(?<lon>-?[0-9.]+)',
})
proof.data   // { lat: "51.19...", lon: "-0.53..." }
```

---

## Run an attestor

A hosted Verity attestor is live at `wss://verity-attestor-production.up.railway.app/ws` (the SDK's default). To run your **own** — locally for development or on **Railway** for production — full steps are in [`services/attestor/README.md`](services/attestor/README.md).

```bash
# local, quickest path
git clone https://github.com/reclaimprotocol/attestor-core.git
cd attestor-core && git checkout 67eade1f2436e071601fba00ef5e26917bab30c2
npm install --ignore-scripts && npm rebuild && npm run download:zk-files
PRIVATE_KEY=$(node -e "console.log(require('ethers').Wallet.createRandom().privateKey)")
PORT=8001 PRIVATE_KEY=$PRIVATE_KEY node --experimental-strip-types src/scripts/start-server.ts
# → "WS server listening ... signerAddress: 0x…"  (that address is what verifiers trust)
```

On boot it prints its **signer address** — copy it into your app's `trustedAttestors`.

---

## On-chain verification (Horizen)

Verify a proof inside a smart contract on the Horizen (ZEN) L3. The `VerityVerifier`
contract recovers the attestor signature and checks it against the attestors you trust —
one call turns a proof into contract-ready calldata:

```js
import { toOnchainProof } from '@verity/sdk'

const onchain = toOnchainProof(proof)            // { claimInfo, signedClaim }
const ok = await verifier.isValidProof(onchain)  // true — verified on-chain
// or gate an action:  require(verifier.verifyProof(onchain))
```

**Live on Horizen mainnet (26514): [`0x85804b684Ce86AC1773950161886741862EE9DBB`](https://explorer.horizen.io/address/0x85804b684Ce86AC1773950161886741862EE9DBB)** — trusts the hosted attestor `0x710F…8bd1`; verified against a real proof on-chain.

The contract (`packages/contracts`) is tested against **real** attestor signatures and
rejects tampered claims and untrusted signers. Deploy your own with your attestor's address:

```bash
cd packages/contracts
VERITY_ATTESTORS=0xYourAttestor DEPLOYER_PRIVATE_KEY=0x.. npm run deploy:horizen-testnet
```

Networks: Horizen testnet `2651420`, mainnet `26514` (gas is ETH; fund the deployer via `hub-testnet.horizen.io`).

---

## Notes & gotchas

- **Responses must be uncompressed.** The proof is over the on-wire (encrypted) bytes, so a gzip/brotli body can't be matched. The SDK sends `Accept-Encoding: identity` automatically; pick sources that honor it (some CDNs ignore it).
- **Proving takes ~15–30s** and downloads circuit resources on first run.
- **Keep a stable `appKey`** if you want a consistent app identity across proofs; otherwise one is generated per client.
- **`stwo`** is the default engine and runs everywhere (including macOS). Use **`gnark`** on Linux for faster proofs.

---

## Status & roadmap

| Component | What it is | Status |
|-----------|-----------|--------|
| `@verity/sdk` | prove / verify zkTLS proofs | ✅ working |
| `services/attestor` | the witness + signer | ✅ live on Railway |
| `packages/contracts` | on-chain `VerityVerifier` on Horizen (ZEN) mainnet | ✅ live: `0x8580…9DBB` |
| `apps/demo` | client app: prove an IPL cricket score (ESPN) → verify on Horizen | ✅ working |

**Chain target:** Horizen (ZEN) L3 on Base — testnet `2651420`, mainnet `26514`. Gas is ETH; ZEN is the ecosystem token.

---

## License

MIT
