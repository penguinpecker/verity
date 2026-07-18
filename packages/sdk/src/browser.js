// @verity/sdk/browser — the piece an integrating web app ships.
//
// The heavy lifting (login, cookie capture, zkTLS witnessing) happens in the
// user's Verity extension + the Verity backend; the app just asks for claims:
//
//   import { requestIdentity } from '@verity/sdk/browser'
//   const res = await requestIdentity({ flow: 'aadhaar-age', claims: ['age', 'name', 'dob'] })
//   res.claims          // { age_over_18: true, name: '…', dob: '…' } — attestor-signed
//   res.proofs[0].tx    // the age gate, recorded on Horizen mainnet
//
// 'age' is privacy-preserving (a yes/no predicate — the DOB itself is never
// revealed unless the app explicitly requests, and the user approves, 'dob').

/** True when the user has the Verity extension and it injected the provider. */
export function isAvailable() {
  return typeof window !== 'undefined' && !!window.verity
}

/**
 * Wait up to `timeoutMs` for the extension's provider to be injected.
 * @returns {Promise<boolean>}
 */
export function detect(timeoutMs = 1500) {
  if (isAvailable()) return Promise.resolve(true)
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(isAvailable()), timeoutMs)
    window.addEventListener('verity#initialized', () => { clearTimeout(t); resolve(true) }, { once: true })
  })
}

/**
 * Ask the user to prove identity claims from a portal they already log into.
 * Resolves when the proof lands (the user logs in on their own device meanwhile).
 *
 * @param {object} [opts]
 * @param {'aadhaar-age'|'us-age-idme'} [opts.flow='aadhaar-age']
 * @param {Array<'age'|'name'|'dob'>} [opts.claims=['age']]
 * @param {(stage:string)=>void} [opts.onStatus]  'awaiting-login' | 'proving'
 * @returns {Promise<{pass:boolean, claims:Record<string,any>, proofs:Array<{claim:string, attestor:string, identifier:string, tx?:string, explorer?:string}>, missing:string[], tx?:string, explorer?:string}>}
 */
export async function requestIdentity({ flow = 'aadhaar-age', claims = ['age'], onStatus } = {}) {
  if (!(await detect())) {
    throw new Error('Verity extension not detected — install it, then reload this page.')
  }
  const listener = onStatus ? (e) => onStatus(e.detail.stage) : null
  if (listener) window.addEventListener('verity#status', listener)
  try {
    return await window.verity.request({ flow, claims })
  } finally {
    if (listener) window.removeEventListener('verity#status', listener)
  }
}
