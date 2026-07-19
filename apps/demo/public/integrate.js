// The live integration demo. This page IS an integrating app, and it runs the
// exact SDK call shown in the snippet: requestIdentity() opens a private hosted
// browser (Verity's remote-browser) as a modal, the user logs into the REAL
// myAadhaar there — no extension — and the signed claims come back. Nothing mocked.
import { requestIdentity } from '/verity-sdk.js'

const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const EXPLORER = 'https://explorer.horizen.io'
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
const HOSTED = LOCAL ? 'http://localhost:4199' : 'https://verity-browser-production.up.railway.app'
const $ = (id) => document.getElementById(id)
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')

$('nav-contract').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

// ---- hosted-browser reachability + egress status ----------------------------
fetch(`${HOSTED}/api/health`).then((r) => r.json()).then((h) => {
  const up = !!h.ok
  // Locally the hosted browser egresses from THIS machine's own IP, so a proxy is
  // irrelevant — a residential Indian connection renders myAadhaar directly.
  const egress = LOCAL || !!h.proxy
  $('ext-state').textContent = !up ? 'unreachable' : LOCAL ? 'up · local IP' : egress ? 'ready · India egress' : 'up · no India egress'
  const warn = !up || !egress
  $('ext-state').style.color = warn ? 'var(--amber)' : ''
  $('ext-dot').style.background = warn ? 'var(--amber)' : ''
  $('egress-notice').hidden = !(up && !egress)
}).catch(() => {
  $('ext-state').textContent = 'unreachable'
  $('ext-state').style.color = 'var(--amber)'; $('ext-dot').style.background = 'var(--amber)'
})

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
  ['awaiting-login', 'Waiting for you to log into myAadhaar (hosted browser)'],
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

// ---- run — the exact SDK call the snippet shows -----------------------------
const CLAIM_LABEL = { name: 'name', dob: 'date of birth' }
let running = false

async function run() {
  if (running) return
  running = true
  $('run').disabled = true
  $('err').hidden = true; $('seal').hidden = true; $('result').hidden = true; $('payload').hidden = true
  $('pipeline').hidden = false
  renderSteps(); setStage('awaiting-login', 'active')
  try {
    const res = await requestIdentity({
      flow: 'aadhaar-age',
      claims: selectedClaims(),
      host: HOSTED,
      onStatus: (stage) => { if (STAGES.some((s) => s[0] === stage)) setStage(stage, 'active') },
    })
    setStage('done', 'done')
    showResult(res)
  } catch (e) {
    // A cancel just resets; a real error is surfaced.
    if (!/cancel/i.test(String(e.message || e))) { $('err').textContent = String(e.message || e); $('err').hidden = false }
    $('pipeline').hidden = true
  } finally {
    running = false
    $('run').disabled = false
    $('run').querySelector('.run-label').textContent = 'Verify again'
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
  if (res.attestor) row('attestor', short(res.attestor))
  if (rec) row('transaction', `<a href="${rec.explorer}" target="_blank" rel="noopener">${short(rec.tx)} ↗</a>`)
  $('result').hidden = false

  $('payload-json').textContent = JSON.stringify(
    { pass: res.pass, claims: res.claims, proofs: res.proofs, missing: res.missing }, null, 2)
  $('payload').hidden = false

  if (rec) { $('seal-link').href = rec.explorer; $('seal').hidden = false }
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) }

$('run').addEventListener('click', run)
