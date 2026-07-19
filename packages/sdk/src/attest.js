// Verity re-attestation — the unifying primitive across all rails.
//
// Every rail (Anon Aadhaar, Account Aggregator, signed PDF, social, zkTLS) ends the
// same way: the backend becomes convinced of an assertion, then the VERITY ATTESTOR
// signs it into a claim the on-chain VerityVerifier accepts. This mints exactly that
// claim, byte-compatible with Claims.serialise() / hashClaimInfo() in the contract
// (Reclaim-compatible), so the signature recovers to the attestor on-chain.
import { Wallet, keccak256, toUtf8Bytes } from 'ethers'

/**
 * Mint an attestor-signed Verity proof for an arbitrary assertion.
 * @param {object} req
 * @param {string} req.attestorKey  0x attestor private key (env only — never hardcode)
 * @param {string} req.provider     e.g. 'verity-aadhaar'
 * @param {object|string} req.parameters  the assertion, e.g. { claim:'age_over_18', value:true }
 * @param {object|string} req.context     rail/nullifier/timestamp metadata (no PII)
 * @param {string} [req.owner]       0x address the claim is bound to (defaults to attestor addr)
 * @param {number} [req.epoch=1]
 * @param {number} [req.timestampS]  unix seconds (defaults to now)
 * @returns {{ proof: object, identifier: string, serialised: string, attestor: string }}
 */
export function mintSignedProof({ attestorKey, provider, parameters, context, owner, epoch = 1, timestampS }) {
  const wallet = new Wallet(attestorKey)
  const params = typeof parameters === 'string' ? parameters : JSON.stringify(parameters)
  const ctx = typeof context === 'string' ? context : JSON.stringify(context || {})
  const ts = timestampS ?? Math.floor(Date.now() / 1000)
  const own = (owner || wallet.address).toLowerCase()

  // identifier = keccak256(provider "\n" parameters "\n" context)  — matches hashClaimInfo
  const identifier = keccak256(toUtf8Bytes(`${provider}\n${params}\n${ctx}`))
  // serialised = identifier "\n" owner "\n" timestampS "\n" epoch  — matches Claims.serialise
  const serialised = `${identifier}\n${own}\n${ts}\n${epoch}`

  return {
    proof: {
      claimInfo: { provider, parameters: params, context: ctx },
      signedClaim: {
        claim: { identifier, owner: own, timestampS: ts, epoch },
        signatures: [null], // filled by mintSignedProofAsync (signMessage is async)
      },
    },
    identifier, serialised, attestor: wallet.address, _wallet: wallet,
  }
}

/** Async variant that attaches the EIP-191 signature (ethers signMessage is async). */
export async function mintSignedProofAsync(req) {
  const out = mintSignedProof(req)
  const sig = await out._wallet.signMessage(out.serialised)
  out.proof.signedClaim.signatures = [sig]
  delete out._wallet
  return out
}
