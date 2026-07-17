# Verity

Prove real data from any HTTPS endpoint with **zkTLS**, then verify it — off-chain or
on the **ZEN (Horizen) appchain**. A user logs into the real source; a Verity attestor
witnesses the TLS session and signs a claim; only the proven value is revealed, never
the credentials.

## Layout

| Path | What it is | Status |
|------|-----------|--------|
| `packages/sdk` | `@verity/sdk` — generate & verify zkTLS proofs. Dead-simple API. | working |
| `services/attestor` | The Verity attestor (witness + signer). Railway-deployable. | working (self-host) |
| `packages/contracts` | On-chain verifier for the Horizen L3 (attestor-signature check). | planned |
| `apps/data-source` | A real data source API to prove against. | planned |
| `apps/demo` | Client app demonstrating the SDK against the data source. | planned |

## Quick start

Run an attestor (see `services/attestor/README.md`), then:

```js
import { VerityClient } from '@verity/sdk'

const verity = new VerityClient({ attestorUrl: 'ws://localhost:8001/ws' })

const proof = await verity.prove({
  url: 'https://api.wheretheiss.at/v1/satellites/25544',
  match: '"latitude":(?<latitude>-?[0-9.]+)',
})

console.log(proof.data)            // { latitude: '51.19...' }  — proven from the live API
console.log(await verity.verify(proof))  // true
await verity.close()
```

## How it works

1. The SDK opens the request **through the attestor**, which relays only ciphertext and
   independently records the TLS transcript.
2. The client generates a zero-knowledge proof that the response decrypts to a value
   matching your regex — without revealing the session key or any secret headers.
3. The attestor checks the proof and **signs** the claim with its key.
4. Anyone can verify the signature — in `verify()`, in a backend, or in the on-chain
   verifier contract on Horizen.

The chain target is Horizen (ZEN) L3 on Base — testnet `2651420`, mainnet `26514`.
Gas is ETH; ZEN is the ecosystem token.
