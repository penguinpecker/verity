// @verity/sdk/browser — one call gets your app attestor-signed identity claims,
// with NO extension and no install.
//
//   import { requestIdentity } from '@verity/sdk/browser'
//   const res = await requestIdentity({ flow: 'aadhaar-age', claims: ['age', 'name'] })
//   res.claims          // { age_over_18: true, name: '…' } — attestor-signed
//   res.proofs[0].tx    // the age gate, recorded on Horizen mainnet
//
// requestIdentity() opens a private browser Verity hosts (the remote-browser) as a
// modal, streamed into your page. The user logs into the portal themselves — their
// login and OTP happen in that isolated browser and never reach your app. When they
// finish, the hosted browser witnesses the session over TLS and posts the signed
// claims back. 'age' is a yes/no predicate (DOB never revealed); 'name'/'dob' are
// selective disclosures the user sees and approves.

const DEFAULT_HOST = 'https://verity-browser-production.up.railway.app'

/**
 * @param {object} [opts]
 * @param {'aadhaar-age'|'us-age-idme'} [opts.flow='aadhaar-age']
 * @param {Array<'age'|'name'|'dob'>} [opts.claims=['age']]
 * @param {string} [opts.host]  hosted-browser base URL (defaults to Verity's)
 * @param {(stage:string)=>void} [opts.onStatus]  'awaiting-login' | 'proving'
 * @returns {Promise<{pass:boolean, claims:Record<string,any>, proofs:Array, missing:string[], attestor?:string, tx?:string, explorer?:string}>}
 */
export function requestIdentity({ flow = 'aadhaar-age', claims = ['age'], host = DEFAULT_HOST, onStatus } = {}) {
  if (typeof window === 'undefined') return Promise.reject(new Error('requestIdentity() runs in a browser.'))
  return new Promise((resolve, reject) => {
    const src = `${host}/?flow=${encodeURIComponent(flow)}&claims=${encodeURIComponent(claims.join(','))}`
      + `&embed=1&origin=${encodeURIComponent(location.origin)}`
    const modal = buildModal(src)

    const onMsg = (e) => {
      if (e.origin !== host || !e.data || !e.data.__verity) return
      if (e.data.__verity === 'hosted-status') onStatus && onStatus(e.data.stage)
      else if (e.data.__verity === 'hosted-result') { cleanup(); resolve(e.data.result) }
      // 'hosted-error' is left to the modal so the user can retry inside it.
    }
    const cleanup = () => { window.removeEventListener('message', onMsg); modal.remove() }
    modal.onCancel = () => { cleanup(); reject(new Error('Verification cancelled.')) }
    window.addEventListener('message', onMsg)
  })
}

let stylesInjected = false
function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true
  const css = `
  .verity-ov{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:24px;font-family:system-ui,sans-serif}
  .verity-bd{position:absolute;inset:0;background:rgba(3,5,7,.78);backdrop-filter:blur(4px)}
  .verity-card{position:relative;z-index:1;width:min(1040px,96vw);max-height:92vh;display:flex;flex-direction:column;background:#0c0e11;border:1px solid rgba(255,255,255,.1);border-radius:16px;overflow:hidden;box-shadow:0 40px 120px -30px rgba(0,0,0,.9)}
  .verity-hd{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);color:#e9ecef;font-size:14px}
  .verity-x{background:none;border:1px solid rgba(255,255,255,.1);color:#868f99;width:30px;height:30px;border-radius:8px;cursor:pointer;font-size:13px}
  .verity-x:hover{color:#ff6b6b;border-color:rgba(255,107,107,.35)}
  .verity-fr{width:100%;height:min(700px,78vh);border:0;background:#05070a;display:block}
  .verity-ft{padding:11px 18px;border-top:1px solid rgba(255,255,255,.06);font-size:11px;color:#565d66;text-align:center;font-family:ui-monospace,monospace}`
  const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s)
}

function buildModal(src) {
  injectStyles()
  const ov = document.createElement('div'); ov.className = 'verity-ov'
  ov.innerHTML = `
    <div class="verity-bd" data-close></div>
    <div class="verity-card">
      <div class="verity-hd"><span>Verify with Verity</span><button class="verity-x" data-close title="Cancel">✕</button></div>
      <iframe class="verity-fr" title="Verity hosted browser" allow="clipboard-write"></iframe>
      <div class="verity-ft">Login runs in a browser Verity hosts · your credentials never reach this app</div>
    </div>`
  ov.querySelector('iframe').src = src
  const api = {
    onCancel: () => {},
    remove: () => { document.body.style.overflow = ''; ov.remove() },
  }
  ov.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => api.onCancel()))
  document.body.appendChild(ov)
  document.body.style.overflow = 'hidden'
  return api
}

export default { requestIdentity }
