const FLOWS = {
  'aadhaar-age': { region: '🇮🇳 India', title: 'Aadhaar age check', open: 'https://myaadhaar.uidai.gov.in/', question: 'Is this person 18 or older?', reveals: 'age ≥ 18 (yes/no)', hides: 'DOB, Aadhaar number, name, address, photo' },
  'us-age-idme': { region: '🇺🇸 US', title: 'US age check · ID.me', open: 'https://account.id.me/', question: 'Is this person 21 or older?', reveals: 'age ≥ 21 (yes/no)', hides: 'DOB, SSN, legal name, documents' },
}
const EXPLORER = 'https://explorer.horizen.io'
const $ = (id) => document.getElementById(id)
const short = (a) => (a ? a.slice(0, 7) + '…' + a.slice(-5) : '—')
const flowFor = (url) => (!url ? null : url.includes('uidai.gov.in') ? 'aadhaar-age' : url.includes('id.me') ? 'us-age-idme' : null)

let flowId = null, proving = false

document.querySelectorAll('.portal').forEach((b) => (b.onclick = () => chrome.tabs.create({ url: FLOWS[b.dataset.flow].open })))

async function refresh() {
  if (proving) return
  const st = await chrome.runtime.sendMessage({ type: 'getState' })
  flowId = flowFor(st && st.url)
  if (!flowId) { $('off').hidden = false; $('on').hidden = true; return }
  const f = FLOWS[flowId]
  $('off').hidden = true; $('on').hidden = false
  $('region').textContent = f.region; $('title').textContent = f.title
  $('question').textContent = f.question; $('reveals').textContent = f.reveals; $('hides').textContent = f.hides
  const ready = !!(st && st.captured)
  $('status').className = 'status' + (ready ? ' ready' : '')
  $('status-dot')
  $('status-text').textContent = ready ? 'Profile data detected — ready to prove.' : 'Log in fully and open your profile page…'
  $('prove').disabled = !ready
}

$('prove').onclick = async () => {
  if (!flowId) return
  proving = true
  $('prove').disabled = true
  $('err').hidden = true; $('result').hidden = true
  $('status').className = 'status busy'; $('status-text').textContent = 'Witnessing over TLS · signing · recording on-chain…'
  try {
    const r = await chrome.runtime.sendMessage({ type: 'prove', flow: flowId })
    if (!r || r.error) throw new Error((r && r.error) || 'failed')
    $('result').hidden = false
    const v = $('verdict')
    if (r.pass) { v.textContent = 'YES'; v.className = 'verdict'; $('vsub').textContent = r.question + ' — proven, nothing else disclosed.' }
    else { v.textContent = 'NO'; v.className = 'verdict no'; $('vsub').textContent = r.reason || 'Predicate not satisfied.' }
    $('f-att').textContent = short(r.attestor)
    $('f-tx').innerHTML = r.tx ? `<a href="${r.explorer}" target="_blank">${short(r.tx)} ↗</a>` : '—'
    $('status').className = 'status ready'; $('status-text').textContent = 'Done.'
  } catch (e) {
    $('err').hidden = false; $('err').textContent = String(e.message || e)
    $('status').className = 'status'; $('status-text').textContent = 'Try again.'
  } finally { proving = false; $('prove').disabled = false }
}

refresh()
setInterval(refresh, 1500)
