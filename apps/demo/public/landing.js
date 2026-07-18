const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
const API = LOCAL ? '' : (window.VERITY_PROVER || 'https://verity-prover-production.up.railway.app')
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const EXPLORER = 'https://explorer.horizen.io'
const $ = (id) => document.getElementById(id)

$('nav-contract').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

fetch(API + '/api/sources')
  .then((r) => r.json())
  .then((list) => {
    const grid = $('grid')
    grid.innerHTML = ''
    list.forEach((s, i) => {
      const a = document.createElement('a')
      a.className = 'card reveal'
      a.style.setProperty('--d', 4 + i)
      a.href = `/verify.html?source=${s.id}`
      a.innerHTML = `
        <div class="card-tag mono">${s.tag}</div>
        <div class="card-label">${s.label}</div>
        <div class="card-cur mono">—</div>
        <div class="card-go mono">prove &amp; verify →</div>`
      grid.appendChild(a)
      fetch(API + `/api/current?source=${s.id}`)
        .then((r) => r.json())
        .then((d) => { const el = a.querySelector('.card-cur'); if (el && d.headline) el.textContent = d.sub || d.headline })
        .catch(() => {})
    })
    addIdentityCard(list.length)
  })
  .catch(() => { $('grid').innerHTML = '<p class="grid-loading mono">could not reach the prover</p>'; addIdentityCard(0) })

// Identity claims (Aadhaar) — the SDK integration flow, not a public feed, so it
// renders whether or not the prover API is reachable.
function addIdentityCard(after) {
  const id = document.createElement('a')
  id.className = 'card reveal'
  id.style.setProperty('--d', 4 + after)
  id.href = '/integrate.html'
  id.innerHTML = `
    <div class="card-tag mono">identity · aadhaar</div>
    <div class="card-label">Verify your users</div>
    <div class="card-cur mono">age ≥ 18 · name · dob — via the SDK</div>
    <div class="card-go mono">integrate →</div>`
  $('grid').appendChild(id)
}
