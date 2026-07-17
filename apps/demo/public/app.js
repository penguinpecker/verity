const SOURCE = new URLSearchParams(location.search).get('source') || 'cricket'
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
const API = LOCAL ? '' : (window.VERITY_PROVER || 'https://verity-prover-production.up.railway.app')
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const ATTESTOR = '0x710FC3548Ed4F77A8Cffa179639866798Deb8bd1'
const EXPLORER = 'https://explorer.horizen.io'

const STAGES = [
  ['connecting', 'Connecting to attestor'],
  ['sending-request-data', 'Requesting data over TLS'],
  ['waiting-for-response', 'Witnessing TLS response'],
  ['generating-zk-proofs', 'Generating zero-knowledge proof'],
  ['waiting-for-verification', 'Attestor verifying & signing'],
  ['submitting-tx', 'Recording on Horizen mainnet · tx'],
]

const $ = (id) => document.getElementById(id)
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')

$('nav-contract').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

let source = null
let currentData = null

fetch(API + '/api/sources')
  .then((r) => r.json())
  .then((list) => {
    source = list.find((s) => s.id === SOURCE) || list[0]
    $('src-host').textContent = source.host
    $('src-pair').textContent = source.tag
    $('attested-k').textContent = source.valueLabel
    document.title = 'Verity — ' + source.label
    tick()
    setInterval(tick, 30000)
  })
  .catch(() => {})

async function tick() {
  if (!source) return
  try {
    const d = await (await fetch(API + `/api/current?source=${source.id}`)).json()
    if (d.headline) { $('live-match').textContent = d.headline; currentData = d }
  } catch { /* ignore */ }
}

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
    if (i < idx) { li.classList.add('done'); li.querySelector('.dot').textContent = '✓' }
    else if (i === idx) {
      if (state === 'done') { li.classList.add('done'); li.querySelector('.dot').textContent = '✓' }
      else li.classList.add('active')
    }
  })
}

function run() {
  if (!source) return
  const btn = $('run')
  btn.disabled = true
  $('err').hidden = true
  $('seal').hidden = true
  $('result').hidden = true
  $('pipeline').hidden = false
  renderSteps()

  const es = new EventSource(API + `/api/prove?source=${source.id}`)
  es.addEventListener('step', (e) => {
    const { name } = JSON.parse(e.data)
    if (STAGES.some((s) => s[0] === name)) setStage(name, 'active')
  })
  es.addEventListener('proof', (e) => {
    const p = JSON.parse(e.data)
    setStage('waiting-for-verification', 'done')
    $('attested-score').textContent = (p.prefix || '') + p.value
    if (currentData) $('attested-ctx').textContent = currentData.sub || currentData.headline
    $('fact-attestor').textContent = short(p.attestor)
    $('fact-id').textContent = short(p.identifier)
    $('result').hidden = false
  })
  es.addEventListener('tx', (e) => {
    const t = JSON.parse(e.data)
    if (t.status === 'pending') {
      setStage('submitting-tx', 'active')
      $('fact-tx').innerHTML = `<a href="${t.explorer}" target="_blank" rel="noopener">${short(t.hash)} · pending…</a>`
    } else {
      setStage('submitting-tx', 'done')
      $('fact-tx').innerHTML = `<a href="${t.explorer}" target="_blank" rel="noopener">${short(t.hash)} ↗</a>`
      $('seal-link').href = t.explorer
      $('seal').hidden = false
      es.close(); done()
    }
  })
  es.addEventListener('error', (e) => {
    let msg = ''
    try { msg = JSON.parse(e.data).message } catch { /* stream closed */ }
    if (msg) showError(msg)
    es.close(); done()
  })
}

function showError(msg) { const el = $('err'); el.textContent = msg; el.hidden = false }
function done() {
  const btn = $('run'); btn.disabled = false
  btn.querySelector('.run-label').textContent = 'Prove again'
  btn.querySelector('.run-sub').textContent = 'new live proof + tx'
}

$('run').addEventListener('click', run)
