// @verity/sdk — generate & verify zkTLS proofs of real web data against a Verity attestor.
//
// A "proof" here is a claim that a specific value was returned by a specific HTTPS
// endpoint, witnessed by a Verity attestor and signed with its key. The value is
// revealed selectively (via a regex); the rest of the response — and any secret
// headers/cookies used to fetch it — never leave the client.

import { setCryptoImplementation } from '@reclaimprotocol/tls'
import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'
import {
  createClaimOnAttestor,
  assertValidClaimSignatures,
  AttestorClient,
  DEFAULT_METADATA,
} from '@reclaimprotocol/attestor-core'
import { Wallet } from 'ethers'

// The TLS layer needs a platform crypto implementation wired in once, up front.
setCryptoImplementation(webcryptoCrypto)

const DEFAULT_ATTESTOR_URL =
  (typeof process !== 'undefined' && process.env && process.env.VERITY_ATTESTOR_URL) ||
  'ws://localhost:8001/ws'

const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {},
  child() { return this },
}

/**
 * VerityClient — the whole surface a developer needs.
 *
 *   const verity = new VerityClient({ attestorUrl })
 *   const proof  = await verity.prove({ url, match: '"price":(?<price>[0-9.]+)' })
 *   proof.data                 // { price: '...' }  ← proven from the live endpoint
 *   await verity.verify(proof) // true
 *   await verity.close()
 */
export class VerityClient {
  /**
   * @param {object} [opts]
   * @param {string} [opts.attestorUrl]  ws(s):// URL of the Verity attestor.
   * @param {string} [opts.appKey]       0x-prefixed private key identifying the app
   *                                      (the "owner" of claims). Auto-generated if omitted.
   * @param {string} [opts.zkEngine]     'stwo' (default) | 'snarkjs' | 'gnark'.
   * @param {string[]} [opts.trustedAttestors] lowercased attestor addresses to accept.
   */
  constructor({ attestorUrl = DEFAULT_ATTESTOR_URL, appKey, zkEngine = 'stwo', trustedAttestors } = {}) {
    this.attestorUrl = attestorUrl
    this.zkEngine = zkEngine
    this.appKey = appKey || Wallet.createRandom().privateKey
    this.appId = new Wallet(this.appKey).address
    this.trustedAttestors = (trustedAttestors || []).map((a) => a.toLowerCase())
    this._client = null
  }

  _attestorClient() {
    if (!this._client) this._client = new AttestorClient({ url: this.attestorUrl, logger: silentLogger })
    return this._client
  }

  /**
   * Generate a real zkTLS proof that `url` returned data matching `match`.
   *
   * @param {object} req
   * @param {string} req.url
   * @param {'GET'|'POST'|'PUT'} [req.method='GET']
   * @param {Record<string,string>} [req.headers]     public request headers
   * @param {string} [req.match]                       regex whose named groups become proof.data
   * @param {Array}  [req.matches]                     explicit responseMatches (advanced)
   * @param {Array}  [req.redactions]                  explicit responseRedactions (advanced)
   * @param {object} [req.secretParams]                secret headers/cookies (never revealed)
   * @param {(step:any)=>void} [req.onStep]
   * @returns {Promise<VerityProof>}
   */
  async prove({ url, method = 'GET', headers = {}, match, matches, redactions, secretParams, onStep }) {
    if (!url) throw new Error('prove(): url is required')
    if (!match && !matches) throw new Error('prove(): provide `match` (regex) or `matches`')

    const responseMatches = matches || [{ type: 'regex', value: match }]
    const responseRedactions = redactions || (match ? [{ regex: match }] : [])

    // Uncompressed responses are required — the reveal happens on the on-wire bytes.
    const reqHeaders = { 'Accept-Encoding': 'identity', ...headers }
    // The http provider requires a non-empty secretParams object.
    const sec = secretParams || { headers: {} }

    const res = await createClaimOnAttestor({
      name: 'http',
      params: { url, method, headers: reqHeaders, responseMatches, responseRedactions },
      secretParams: sec,
      ownerPrivateKey: this.appKey,
      client: this._attestorClient(),
      zkEngine: this.zkEngine,
      onStep,
    })

    if (res.error) {
      const msg = typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error)
      throw new Error(`Verity attestor rejected the claim: ${msg}`)
    }

    return toVerityProof(res)
  }

  /**
   * Verify a proof's attestor signatures (and, if configured, that the signer is trusted).
   * @param {VerityProof} proof
   * @returns {Promise<boolean>}
   */
  async verify(proof) {
    return verifyProof(proof, { trustedAttestors: this.trustedAttestors })
  }

  /** Close the underlying attestor connection so the process can exit cleanly. */
  async close() {
    const c = this._client
    this._client = null
    if (!c) return
    try {
      if (typeof c.terminateConnection === 'function') await c.terminateConnection()
      else if (typeof c.close === 'function') await c.close()
    } catch { /* already closed */ }
  }
}

/**
 * @typedef {object} VerityProof
 * @property {Record<string,string>} data   the revealed, proven values
 * @property {string} attestor              signer address
 * @property {string} identifier            claim identifier (hash)
 * @property {object} claim                 raw claim data
 * @property {object} signatures            attestor signatures
 * @property {object} raw                   full ClaimTunnelResponse
 */

function toVerityProof(res) {
  let data = {}
  try { data = JSON.parse(res.claim?.context || '{}').extractedParameters || {} } catch { /* ignore */ }
  return {
    data,
    attestor: res.signatures?.attestorAddress,
    identifier: res.claim?.identifier,
    claim: res.claim,
    signatures: res.signatures,
    raw: res,
  }
}

/**
 * Standalone verifier — checks the attestor signatures are valid, and optionally
 * that the signer is in a trusted set.
 * @param {VerityProof} proof
 * @param {{trustedAttestors?: string[]}} [opts]
 * @returns {Promise<boolean>}
 */
export async function verifyProof(proof, { trustedAttestors = [] } = {}) {
  const res = proof?.raw || proof
  try {
    await assertValidClaimSignatures(res, DEFAULT_METADATA)
  } catch {
    return false
  }
  if (trustedAttestors.length) {
    const signer = (res.signatures?.attestorAddress || '').toLowerCase()
    if (!trustedAttestors.includes(signer)) return false
  }
  return true
}

export default VerityClient
