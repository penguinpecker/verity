const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const EXPLORER = 'https://explorer.horizen.io'
const WS_BASE = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/session'

const $ = (id) => document.getElementById(id)
const short = (a) => (a ? a.slice(0, 7) + '…' + a.slice(-5) : '—')
$('contract-link').href = $('contract-link2').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

const PROVE_STEPS = [
  ['reading-session', 'Reading your logged-in session'],
  ['witnessing-tls', 'Attestor witnessing the TLS response'],
  ['generating-zk-proofs', 'Generating the zero-knowledge predicate'],
  ['waiting-for-verification', 'Attestor verifying & signing'],
  ['recording-onchain', 'Recording on Horizen mainnet'],
]

let ws = null
let flow = null
let screenFocused = false

// ---------- picker ----------
fetch('/api/flows').then((r) => r.json()).then((flows) => {
  const wrap = $('flow-cards')
  wrap.innerHTML = ''
  flows.forEach((f) => {
    const el = document.createElement('div')
    el.className = 'card'
    el.innerHTML = `
      <span class="region">${f.region === 'IN' ? '🇮🇳 India' : '🇺🇸 United States'}</span>
      <h3>${f.title}</h3>
      <div class="src">${f.source}</div>
      <p class="qq">“${f.question}”</p>
      <div class="rv">→ ${f.reveals}</div>
      <div class="go">open this check <span>↗</span></div>`
    el.onclick = () => openStage(f)
    wrap.appendChild(el)
  })
})

// ---------- stage ----------
function openStage(f) {
  flow = f
  $('picker').hidden = true
  $('stage').hidden = false
  $('stage-region').textContent = f.region === 'IN' ? '🇮🇳 IN' : '🇺🇸 US'
  $('stage-name').textContent = f.title
  $('p-question').textContent = f.question
  $('p-reveals').textContent = '✓ reveals only: ' + f.reveals
  $('p-hides').textContent = f.hides
  $('flow-hint').textContent = f.hint
  $('screen-overlay').style.display = 'flex'
  $('verdict').hidden = true; $('prove-steps').hidden = true; $('prove-err').hidden = true
  $('prove-btn').disabled = false
  connect(f.id)
}

$('back-home').onclick = () => { try { ws && ws.close() } catch {} ws = null; $('stage').hidden = true; $('picker').hidden = false }
$('nav-back').onclick = () => send({ type: 'back' })

function connect(flowId) {
  ws = new WebSocket(`${WS_BASE}?flow=${encodeURIComponent(flowId)}`)
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'frame') $('screen').src = 'data:image/jpeg;base64,' + m.data
    else if (m.type === 'ready') { $('screen-overlay').style.display = 'none'; $('omni').textContent = m.url }
    else if (m.type === 'url') $('omni').textContent = m.url
    else if (m.type === 'prove-step') markStep(m.name)
    else if (m.type === 'prove-proof') { $('f-attestor').textContent = short(m.attestor); $('f-id').textContent = short(m.identifier) }
    else if (m.type === 'prove-tx') $('f-tx').innerHTML = `<a href="${m.explorer}" target="_blank" rel="noopener">${short(m.hash)} · pending…</a>`
    else if (m.type === 'prove-result') showResult(m)
    else if (m.type === 'prove-error') showErr(m.message)
  }
  ws.onclose = () => { if (!$('stage').hidden) $('secure-badge').textContent = 'session closed' }
}

const send = (o) => { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(o)) } catch {} }

// ---------- input forwarding ----------
const screen = $('screen')
const norm = (e) => { const r = screen.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } }
let mdown = false
screen.addEventListener('mousedown', (e) => { e.preventDefault(); screenFocused = true; mdown = true; const p = norm(e); send({ type: 'input', kind: 'mouse', event: 'mousePressed', ...p, button: e.button === 2 ? 'right' : 'left' }) })
window.addEventListener('mouseup', (e) => { if (!mdown) return; mdown = false; const p = norm(e); send({ type: 'input', kind: 'mouse', event: 'mouseReleased', ...p, button: e.button === 2 ? 'right' : 'left' }) })
screen.addEventListener('mousemove', (e) => { const p = norm(e); send({ type: 'input', kind: 'mouse', event: 'mouseMoved', ...p, down: mdown }) })
screen.addEventListener('wheel', (e) => { e.preventDefault(); const p = norm(e); send({ type: 'input', kind: 'wheel', ...p, dx: e.deltaX, dy: e.deltaY }) }, { passive: false })
screen.addEventListener('contextmenu', (e) => e.preventDefault())
document.addEventListener('mousedown', (e) => { if (!screen.contains(e.target)) screenFocused = false })

const printable = (k) => k.length === 1
function keyMsg(event, e) { return { type: 'input', kind: 'key', event, key: e.key, code: e.code, keyCode: e.keyCode, text: printable(e.key) ? e.key : '' } }
window.addEventListener('keydown', (e) => { if (!screenFocused || $('stage').hidden) return; if (['Tab', 'Backspace', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) e.preventDefault(); send(keyMsg('keyDown', e)) })
window.addEventListener('keyup', (e) => { if (!screenFocused || $('stage').hidden) return; send(keyMsg('keyUp', e)) })

// ---------- prove ----------
$('prove-btn').onclick = () => {
  $('prove-btn').disabled = true
  $('prove-err').hidden = true; $('verdict').hidden = true
  const ol = $('prove-steps'); ol.hidden = false; ol.innerHTML = ''
  PROVE_STEPS.forEach(([k, label]) => { const li = document.createElement('li'); li.dataset.k = k; li.innerHTML = `<span class="dot"></span>${label}`; ol.appendChild(li) })
  send({ type: 'prove' })
}
function markStep(name) {
  const steps = [...$('prove-steps').children]
  const idx = PROVE_STEPS.findIndex((s) => s[0] === name)
  if (idx < 0) return
  steps.forEach((li, i) => { li.classList.remove('active', 'done'); if (i < idx) li.classList.add('done'); else if (i === idx) li.classList.add('active') })
}
function showResult(m) {
  ;[...$('prove-steps').children].forEach((li) => { li.classList.remove('active'); li.classList.add('done') })
  const v = $('verdict'); v.hidden = false
  const badge = $('verdict-badge')
  if (m.pass) { badge.textContent = 'YES'; badge.classList.remove('no'); $('verdict-sub').textContent = m.question + ' — proven, nothing else disclosed.' }
  else { badge.textContent = 'NO'; badge.classList.add('no'); $('verdict-sub').textContent = m.reason || 'Predicate not satisfied.'; $('prove-btn').disabled = false }
  if (m.attestor) $('f-attestor').textContent = short(m.attestor)
  if (m.identifier) $('f-id').textContent = short(m.identifier)
  if (m.tx) $('f-tx').innerHTML = `<a href="${m.explorer}" target="_blank" rel="noopener">${short(m.tx)} ↗</a>`
}
function showErr(msg) { $('prove-err').textContent = msg; $('prove-err').hidden = false; $('prove-btn').disabled = false }
