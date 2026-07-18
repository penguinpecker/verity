// Injected into integrating apps (MAIN world): the page-facing Verity provider.
// An app calls window.verity.request({ flow, claims }) and gets a promise that
// resolves with the verified claims once the user completes their login and the
// proof lands. Progress is surfaced as 'verity#status' CustomEvents.
(() => {
  if (window.verity) return
  let seq = 0
  const pending = new Map()

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__verity) return
    if (e.data.__verity === 'status') {
      window.dispatchEvent(new CustomEvent('verity#status', { detail: { id: e.data.id, stage: e.data.stage } }))
      return
    }
    if (e.data.__verity !== 'result' || !pending.has(e.data.id)) return
    const { resolve, reject } = pending.get(e.data.id)
    pending.delete(e.data.id)
    const r = e.data.result
    if (!r || r.error) reject(new Error((r && r.error) || 'Verity request failed'))
    else resolve(r)
  })

  window.verity = {
    isVerity: true,
    version: '0.2.0',
    /**
     * @param {{ flow?: 'aadhaar-age'|'us-age-idme', claims?: Array<'age'|'name'|'dob'> }} [opts]
     * @returns {Promise<{pass:boolean, claims:object, proofs:Array, tx?:string, explorer?:string}>}
     */
    request(opts = {}) {
      return new Promise((resolve, reject) => {
        const id = 'v' + ++seq + '-' + Date.now()
        pending.set(id, { resolve, reject })
        window.postMessage({ __verity: 'request', id, opts: { flow: opts.flow || 'aadhaar-age', claims: opts.claims || ['age'] } }, location.origin)
      })
    },
  }
  window.dispatchEvent(new Event('verity#initialized'))
})()
