// Verity extension service worker.
//
// Two ways a proof starts:
//  1. Popup — the user opens a portal, logs in, clicks "Prove it" (always the
//     age predicate only — the popup never escalates to disclosure claims).
//  2. Page  — an integrating app calls window.verity.request({ flow, claims })
//     (injected by provider.js). We open the portal, the user logs in on-device,
//     and the proof runs automatically the moment the profile response is seen.
//
// MV3 lifetime: the login wait (Aadhaar OTP) far outlives the worker's ~30s idle
// limit, so ALL cross-event state lives in chrome.storage.session and the request
// timeout is a chrome.alarm — both survive worker termination. The keepalive
// interval only needs to span the proof fetch itself.
const BACKEND = 'https://verity-browser-production.up.railway.app'
const PORTALS = { 'aadhaar-age': 'https://myaadhaar.uidai.gov.in/', 'us-age-idme': 'https://account.id.me/' }
const TIMEOUT_ALARM = 'verity-page-timeout'
const PROVING_STALE_MS = 3 * 60e3 // a prove attempt older than this is presumed dead (worker killed mid-fetch)

const flowForUrl = (url) => (!url ? null : url.includes('uidai.gov.in') ? 'aadhaar-age' : url.includes('id.me') ? 'us-age-idme' : null)

// ---- persistent state (survives worker restarts) ----------------------------
const getCaptured = async () => (await chrome.storage.session.get('captured')).captured || {}
const setCaptured = (map) => chrome.storage.session.set({ captured: map })
const getPageReq = async () => (await chrome.storage.session.get('pageReq')).pageReq || null
const setPageReq = (pr) => (pr ? chrome.storage.session.set({ pageReq: pr }) : chrome.storage.session.remove('pageReq'))

// ---- events -----------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'captured' && sender.tab) { onCaptured(sender.tab.id, msg).catch(() => {}); return }
  if (msg.type === 'getState') { getState().then(sendResponse).catch(() => sendResponse({})); return true }
  if (msg.type === 'prove') { provePopup(msg.flow).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) })); return true }
  if (msg.type === 'page-request' && sender.tab) {
    startPageRequest(msg, sender.tab).then(sendResponse).catch((e) => sendResponse({ error: String(e && e.message || e) }))
    return true
  }
})

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== TIMEOUT_ALARM) return
  const pr = await getPageReq()
  if (pr) await finishPageRequest(pr.id, { error: 'Timed out waiting for the login (10 min).' })
})

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const map = await getCaptured()
  if (map[tabId]) { delete map[tabId]; await setCaptured(map) }
  const pr = await getPageReq()
  if (!pr) return
  if (tabId === pr.portalTabId && !pr.proving) {
    await finishPageRequest(pr.id, { error: 'The login tab was closed before verification completed.' })
  } else if (tabId === pr.tabId) {
    // The requesting app tab is gone — nobody is listening; drop the request.
    await setPageReq(null)
    chrome.alarms.clear(TIMEOUT_ALARM)
  }
})

async function onCaptured(tabId, msg) {
  const map = await getCaptured()
  map[tabId] = { url: msg.url, method: msg.method }
  const keys = Object.keys(map)
  if (keys.length > 20) delete map[keys[0]]
  await setCaptured(map)
  await maybeAutoProve(tabId)
}

async function activeTab() { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); return t }

async function getState() {
  const tab = await activeTab()
  const captured = tab ? (await getCaptured())[tab.id] || null : null
  const pr = await getPageReq()
  return { url: tab && tab.url, captured, pageRequest: pr ? { flow: pr.flow, claims: pr.claims } : null }
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

// MV3 keep-alive across the proof fetch — refcounted so overlapping proves
// can't cut each other's lifeline.
let busyCount = 0, keepaliveTimer = null
const busyUp = () => { if (++busyCount === 1) keepaliveTimer = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20e3) }
const busyDown = () => { if (busyCount > 0 && --busyCount === 0) { clearInterval(keepaliveTimer); keepaliveTimer = null } }

async function proveTab(tabId, flowId, claims) {
  const cap = (await getCaptured())[tabId]
  if (!cap) return { error: 'No profile data seen yet — log in fully and open your profile page, then try again.' }
  const cookieStr = await cookieString(new URL(cap.url).hostname)
  busyUp()
  try {
    const r = await fetch(`${BACKEND}/api/prove-session`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow: flowId, url: cap.url, cookieStr, claims: claims && claims.length ? claims : ['age'] }),
    })
    return await r.json()
  } finally { busyDown() }
}

// Popup path — the age predicate on the active tab, nothing more. Deliberately
// independent of any pending page request: the popup UI promises "reveals only
// yes/no", so it must never adopt a page's disclosure claims.
async function provePopup(flowId) {
  const tab = await activeTab()
  if (!tab) return { error: 'No active tab.' }
  return proveTab(tab.id, flowId, ['age'])
}

// Page path — an app asked for claims. If a matching portal tab already has
// profile data captured, prove right away; otherwise open the portal and wait
// for the capture event.
async function startPageRequest(msg, fromTab) {
  if (await getPageReq()) return { error: 'Another Verity verification is already in progress.' }
  const flow = PORTALS[msg.flow] ? msg.flow : 'aadhaar-age'
  const pr = {
    id: msg.id, tabId: fromTab.id, flow, portalTabId: null,
    claims: Array.isArray(msg.claims) && msg.claims.length ? msg.claims.map(String) : ['age'],
    proving: false, provingSince: 0,
  }
  await setPageReq(pr)
  chrome.alarms.create(TIMEOUT_ALARM, { delayInMinutes: 10 })
  try {
    const caps = await getCaptured()
    for (const tid of Object.keys(caps)) {
      if (flowForUrl(caps[tid].url) !== flow) continue
      const live = await chrome.tabs.get(Number(tid)).catch(() => null)
      if (live) { maybeAutoProve(Number(tid)); return { accepted: true } }
      delete caps[tid]; await setCaptured(caps)
    }
    const portal = await chrome.tabs.create({ url: PORTALS[flow] })
    pr.portalTabId = portal.id
    await setPageReq(pr)
    notifyPage(pr, 'status', { stage: 'awaiting-login' })
    return { accepted: true }
  } catch (e) {
    await setPageReq(null)
    chrome.alarms.clear(TIMEOUT_ALARM)
    return { error: String(e && e.message || e) }
  }
}

async function maybeAutoProve(tabId) {
  let pr = await getPageReq()
  if (!pr) return
  if (pr.proving && Date.now() - pr.provingSince < PROVING_STALE_MS) return
  const cap = (await getCaptured())[tabId]
  if (flowForUrl(cap && cap.url) !== pr.flow) return
  pr.proving = true; pr.provingSince = Date.now()
  await setPageReq(pr)
  notifyPage(pr, 'status', { stage: 'proving' })
  let result
  try { result = await proveTab(tabId, pr.flow, pr.claims) }
  catch (e) { result = { error: String(e && e.message || e) } }
  if (result && result.error) {
    // A failed attempt does not consume the request: leave it pending so the
    // next captured profile response retries; the 10-min alarm is the backstop.
    const cur = await getPageReq()
    if (cur && cur.id === pr.id) { cur.proving = false; cur.provingSince = 0; await setPageReq(cur); notifyPage(cur, 'status', { stage: 'retrying' }) }
    return
  }
  await finishPageRequest(pr.id, result)
}

function notifyPage(pr, kind, payload) {
  chrome.tabs.sendMessage(pr.tabId, { type: `verity-${kind}`, id: pr.id, ...payload }).catch(() => {})
}

// Only ever completes the request it was started for — a stale completion from
// an earlier request can't resolve a newer one.
async function finishPageRequest(id, result) {
  const pr = await getPageReq()
  if (!pr || pr.id !== id) return
  await setPageReq(null)
  chrome.alarms.clear(TIMEOUT_ALARM)
  chrome.tabs.sendMessage(pr.tabId, { type: 'verity-result', id: pr.id, result }).catch(() => {})
  // On success, close the portal tab and bring the app back to front so the
  // user sees their result land.
  if (result && !result.error) {
    if (pr.portalTabId != null) chrome.tabs.remove(pr.portalTabId).catch(() => {})
    chrome.tabs.update(pr.tabId, { active: true }).catch(() => {})
  }
}
