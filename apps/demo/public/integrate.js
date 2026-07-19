// The live integration demo. This page IS an integrating app: it calls the same
// window.verity provider that @verity/sdk/browser wraps, with the claims the
// visitor toggles. Nothing here is simulated — the flow opens the real myAadhaar,
// the proof is a real zkTLS proof, and the tx link is a real Horizen transaction.
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const EXPLORER = 'https://explorer.horizen.io'
const $ = (id) => document.getElementById(id)
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')

$('nav-contract').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

// ---- extension detection -----------------------------------------------------
let extReady = false
let running = false
function setExtState(ready) {
  extReady = ready
  $('ext-state').textContent = ready ? 'connected' : 'not detected'
  $('ext-state').style.color = ready ? '' : 'var(--amber)'
  $('ext-dot').style.background = ready ? '' : 'var(--amber)'
  $('ext-missing').hidden = ready
  // Never re-enable the button while a verification is in flight — the delayed
  // detection re-check fires mid-run otherwise.
  $('run').disabled = running || !ready
}
setExtState(!!window.verity)
window.addEventListener('verity#initialized', () => setExtState(true))
setTimeout(() => setExtState(!!window.verity), 1200)

// ---- claims picker → live snippet -------------------------------------------
const selectedClaims = () => {
  const c = ['age']
  if ($('claim-name').checked) c.push('name')
  if ($('claim-dob').checked) c.push('dob')
  return c
}
function refreshSnippet() {
  const claims = selectedClaims().map((c) => `'${c}'`).join(', ')
  $('snippet').textContent = `import { requestIdentity } from '@verity/sdk/browser'

const res = await requestIdentity({
  flow: 'aadhaar-age',
  claims: [${claims}],
})

res.pass          // true  — age gate cleared
res.claims        // { age_over_18${$('claim-name').checked ? ', name' : ''}${$('claim-dob').checked ? ', dob' : ''} } attestor-signed
res.proofs[0].tx  // recorded on Horizen mainnet`
}
$('claim-name').addEventListener('change', refreshSnippet)
$('claim-dob').addEventListener('change', refreshSnippet)
refreshSnippet()

// ---- pipeline ---------------------------------------------------------------
const STAGES = [
  ['awaiting-login', 'Waiting for you to log into myAadhaar (new tab)'],
  ['proving', 'Witnessing your session over TLS · proving claims'],
  ['done', 'Claims signed · age gate recorded on-chain'],
]
function renderSteps() {
  const ol = $('steps'); ol.innerHTML = ''
  STAGES.forEach(([key, label], i) => {
    const li = document.createElement('li')
    li.dataset.key = key
    li.style.animationDelay = `${i * 45}ms`
    li.innerHTML = `<span class="dot"></span><span>${label}</span>`
    ol.appendChild(li)
  })
}
function setStage(key, state) {
  const rows = [...$('steps').children]
  const idx = STAGES.findIndex((s) => s[0] === key)
  rows.forEach((li, i) => {
    li.classList.remove('active', 'done')
    if (i < idx || (i === idx && state === 'done')) { li.classList.add('done'); li.querySelector('.dot').textContent = '✓' }
    else if (i === idx) li.classList.add('active')
  })
}
window.addEventListener('verity#status', (e) => {
  if (STAGES.some((s) => s[0] === e.detail.stage)) setStage(e.detail.stage, 'active')
})

// ---- run --------------------------------------------------------------------
const CLAIM_LABEL = { name: 'name', dob: 'date of birth' }

async function run() {
  if (!window.verity || running) return
  running = true
  const btn = $('run')
  btn.disabled = true
  $('err').hidden = true; $('seal').hidden = true; $('result').hidden = true; $('payload').hidden = true
  $('pipeline').hidden = false
  renderSteps()
  setStage('awaiting-login', 'active')

  try {
    const res = await window.verity.request({ flow: 'aadhaar-age', claims: selectedClaims() })
    setStage('done', 'done')
    showResult(res)
  } catch (e) {
    $('err').textContent = String(e.message || e)
    $('err').hidden = false
    $('pipeline').hidden = true
  } finally {
    running = false
    btn.disabled = !extReady
    btn.querySelector('.run-label').textContent = 'Verify again'
  }
}

function showResult(res) {
  const v = $('verdict')
  const ageKey = Object.keys(res.claims || {}).find((k) => k.startsWith('age_over_'))
  if (res.pass) { v.textContent = 'YES'; v.className = 'attested-v yes' }
  else { v.textContent = 'NO'; v.className = 'attested-v no' }
  $('verdict-ctx').textContent = res.pass
    ? 'proven from the live myAadhaar session — DOB ' + (res.claims && res.claims.dob ? 'disclosed with user approval' : 'never revealed')
    : (res.reason || 'predicate not satisfied')

  const facts = $('facts'); facts.innerHTML = ''
  const row = (k, vHtml) => { const d = document.createElement('div'); d.innerHTML = `<dt>${k}</dt><dd class="mono">${vHtml}</dd>`; facts.appendChild(d) }
  if (ageKey) row(ageKey.replace(/_/g, ' '), res.claims[ageKey] ? '<span class="chip yes">YES</span>' : '<span class="chip no">NO</span>')
  for (const c of ['name', 'dob']) if (res.claims && res.claims[c] != null) row(CLAIM_LABEL[c], escapeHtml(String(res.claims[c])))
  for (const m of res.missing || []) row(CLAIM_LABEL[m] || m, '<span class="chip miss">not witnessed</span>')
  const rec = (res.proofs || []).find((p) => p.tx)
  row('attestor', short(res.attestor))
  if (rec) row('transaction', `<a href="${rec.explorer}" target="_blank" rel="noopener">${short(rec.tx)} ↗</a>`)
  $('result').hidden = false

  // The exact JSON an integrating backend gets — this run's real response.
  $('payload-json').textContent = JSON.stringify(
    { pass: res.pass, claims: res.claims, proofs: res.proofs, missing: res.missing }, null, 2)
  $('payload').hidden = false

  if (rec) { $('seal-link').href = rec.explorer; $('seal').hidden = false }
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

$('run').addEventListener('click', run)
