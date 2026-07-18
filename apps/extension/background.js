// Verity extension service worker.
// On "prove": read the session cookie for the captured endpoint's domain (on-device,
// including HttpOnly), then POST { flow, endpoint, cookieStr } to the Verity attestor
// backend, which witnesses the request over TLS with the cookie redacted and proves the
// age predicate. The DOB is never revealed; the app gets a yes/no recorded on-chain.
const BACKEND = 'https://verity-browser-production.up.railway.app'
const captured = {} // tabId -> { url, method }

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captured' && sender.tab) { captured[sender.tab.id] = { url: msg.url, method: msg.method }; return }
  if (msg.type === 'getState') { getState().then(sendResponse); return true }
  if (msg.type === 'prove') { prove(msg.flow).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) })); return true }
})

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t }

async function getState() {
  const tab = await activeTab()
  return { url: tab && tab.url, captured: tab ? captured[tab.id] || null : null }
}

async function cookieString(hostname) {
  const parent = hostname.split('.').slice(-2).join('.') // e.g. uidai.gov.in / id.me
  const [a, b] = await Promise.all([
    chrome.cookies.getAll({ domain: hostname }),
    chrome.cookies.getAll({ domain: parent }),
  ])
  const seen = new Set()
  return [...a, ...b].filter((c) => (seen.has(c.name) ? false : seen.add(c.name))).map((c) => `${c.name}=${c.value}`).join('; ')
}

async function prove(flowId) {
  const tab = await activeTab()
  if (!tab) return { error: 'No active tab.' }
  const cap = captured[tab.id]
  if (!cap) return { error: 'No profile data seen yet — log in fully and open your profile page, then click Prove.' }
  const cookieStr = await cookieString(new URL(cap.url).hostname)
  const r = await fetch(`${BACKEND}/api/prove-session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow: flowId, url: cap.url, cookieStr }),
  })
  return await r.json()
}
