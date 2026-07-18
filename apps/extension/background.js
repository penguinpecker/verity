// Verity extension service worker.
//
// Two ways a proof starts:
//  1. Popup — the user opens a portal, logs in, clicks "Prove it".
//  2. Page  — an integrating app calls window.verity.request({ flow, claims })
//     (injected by provider.js). We open the portal, the user logs in on-device,
//     and the proof runs automatically the moment the profile response is seen.
//
// Either way: background reads the session cookie for the captured endpoint's
// domain on-device (including HttpOnly) and POSTs { flow, url, cookieStr, claims }
// to the Verity backend, which witnesses the request over TLS with the cookie
// redacted. 'age' is a no-capture predicate (yes/no only); 'name'/'dob' are
// selective disclosures the user approved on the requesting page.
const BACKEND = 'https://verity-browser-production.up.railway.app'
const PORTALS = { 'aadhaar-age': 'https://myaadhaar.uidai.gov.in/', 'us-age-idme': 'https://account.id.me/' }
const captured = {} // tabId -> { url, method }
let pageReq = null // { id, tabId, flow, claims, portalTabId, proving, timer }

const flowForUrl = (url) => (!url ? null : url.includes('uidai.gov.in') ? 'aadhaar-age' : url.includes('id.me') ? 'us-age-idme' : null)

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captured' && sender.tab) {
    captured[sender.tab.id] = { url: msg.url, method: msg.method }
    maybeAutoProve(sender.tab.id)
    return
  }
  if (msg.type === 'getState') { getState().then(sendResponse); return true }
  if (msg.type === 'prove') { provePopup(msg.flow).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) })); return true }
  if (msg.type === 'page-request' && sender.tab) { startPageRequest(msg, sender.tab).then(sendResponse); return true }
})

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t }

async function getState() {
  const tab = await activeTab()
  return { url: tab && tab.url, captured: tab ? captured[tab.id] || null : null, pageRequest: pageReq ? { flow: pageReq.flow, claims: pageReq.claims } : null }
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

// MV3 keep-alive: a proof round-trip runs well past the worker's 30s idle limit.
let keepalive = null
const busy = (on) => {
  if (on && !keepalive) keepalive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20e3)
  if (!on && keepalive) { clearInterval(keepalive); keepalive = null }
}

async function proveTab(tabId, flowId, claims) {
  const cap = captured[tabId]
  if (!cap) return { error: 'No profile data seen yet — log in fully and open your profile page, then try again.' }
  const cookieStr = await cookieString(new URL(cap.url).hostname)
  busy(true)
  try {
    const r = await fetch(`${BACKEND}/api/prove-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow: flowId, url: cap.url, cookieStr, claims: claims && claims.length ? claims : ['age'] }),
    })
    return await r.json()
  } finally { busy(false) }
}

// Popup path — proves the active tab; if a page request for the same flow is
// waiting, this manual run resolves it too.
async function provePopup(flowId) {
  const tab = await activeTab()
  if (!tab) return { error: 'No active tab.' }
  const claims = pageReq && pageReq.flow === flowId ? pageReq.claims : ['age']
  const result = await proveTab(tab.id, flowId, claims)
  if (pageReq && pageReq.flow === flowId) finishPageRequest(result)
  return result
}

// Page path — an app on the demo origin asked for claims. Open the portal and
// wait: the proof fires automatically when hook.js spots the profile response.
async function startPageRequest(msg, fromTab) {
  if (pageReq) return { error: 'Another Verity verification is already in progress.' }
  const flow = PORTALS[msg.flow] ? msg.flow : 'aadhaar-age'
  pageReq = { id: msg.id, tabId: fromTab.id, flow, claims: Array.isArray(msg.claims) && msg.claims.length ? msg.claims : ['age'], proving: false }
  pageReq.timer = setTimeout(() => finishPageRequest({ error: 'Timed out waiting for the login (10 min).' }), 10 * 60e3)
  const portal = await chrome.tabs.create({ url: PORTALS[flow] })
  pageReq.portalTabId = portal.id
  notifyPage('status', { stage: 'awaiting-login' })
  return { accepted: true }
}

function maybeAutoProve(tabId) {
  if (!pageReq || pageReq.proving) return
  if (flowForUrl(captured[tabId] && captured[tabId].url) !== pageReq.flow) return
  pageReq.proving = true
  notifyPage('status', { stage: 'proving' })
  proveTab(tabId, pageReq.flow, pageReq.claims)
    .then((result) => finishPageRequest(result))
    .catch((e) => finishPageRequest({ error: String(e && e.message || e) }))
}

function notifyPage(kind, payload) {
  if (!pageReq) return
  chrome.tabs.sendMessage(pageReq.tabId, { type: `verity-${kind}`, id: pageReq.id, ...payload }).catch(() => {})
}

function finishPageRequest(result) {
  if (!pageReq) return
  clearTimeout(pageReq.timer)
  const { tabId, portalTabId, id } = pageReq
  pageReq = null
  chrome.tabs.sendMessage(tabId, { type: 'verity-result', id, result }).catch(() => {})
  // On success, close the portal tab and bring the app back to front so the
  // user sees their result land.
  if (result && !result.error) {
    if (portalTabId != null) chrome.tabs.remove(portalTabId).catch(() => {})
    chrome.tabs.update(tabId, { active: true }).catch(() => {})
  }
}
