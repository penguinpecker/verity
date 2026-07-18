// Verity remote-browser proving service.
//
// The user logs into a REAL source inside a browser Verity hosts (streamed to them
// live, driven by their own clicks/keys). No extension, no API credentials. When
// they reach their profile, we take the authenticated response the portal already
// fetched, re-witness that request through the Verity attestor with the session
// cookie redacted, and prove a yes/no age predicate — recorded on Horizen mainnet.
import express from 'express'
import { WebSocketServer } from 'ws'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'
import { VerityClient, toOnchainProof } from '../../packages/sdk/src/index.js'
import { getFlow, flowList } from './flows.js'
import { buildAgePredicate } from './predicate.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 4100
const VIEWPORT = { width: 1000, height: 680 }

// ---- On-chain (Horizen mainnet) ---------------------------------------------
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const HORIZEN_RPC = 'https://horizen.calderachain.xyz/http'
const EXPLORER = 'https://explorer.horizen.io'
const VERIFY_ABI = ['function verifyAndRecord(((string provider,string parameters,string context) claimInfo,((bytes32 identifier,address owner,uint32 timestampS,uint32 epoch) claim,bytes[] signatures) signedClaim) proof) returns (uint256)']
const relayer = process.env.RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RELAYER_PRIVATE_KEY, new JsonRpcProvider(HORIZEN_RPC, 26514))
  : null

// ---- Browser (one instance, one isolated context per session) ---------------
// Primary path is the on-device extension (see apps/extension) — the user's own
// browser handles the login, so the hosted browser here is only for sources that
// serve a datacenter browser directly. Locale/timezone are matched to the source's
// region so the portal renders in the right locale.
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const sessions = new Map()

const jsonParse = (s) => { try { return JSON.parse(s) } catch { return null } }

const REGION = {
  IN: { locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  US: { locale: 'en-US', timezoneId: 'America/New_York' },
}

async function startSession(ws, flow) {
  const r = REGION[flow.region] || REGION.US
  const context = await browser.newContext({
    viewport: VIEWPORT, locale: r.locale, timezoneId: r.timezoneId,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()
  const captured = [] // { url, method, reqHeaders, body }

  page.on('response', async (resp) => {
    try {
      const ct = (resp.headers()['content-type'] || '')
      if (!/json|text|html/.test(ct)) return
      if (resp.status() >= 400) return
      const body = await resp.text()
      if (!body || body.length > 400_000) return
      captured.push({ url: resp.url(), method: resp.request().method(), reqHeaders: resp.request().headers(), body })
      if (captured.length > 40) captured.shift()
    } catch { /* body unavailable — ignore */ }
  })

  const cdp = await context.newCDPSession(page)
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    try { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'frame', data, metadata })) } catch { /* dropped */ }
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })
  page.on('framenavigated', (f) => { if (f === page.mainFrame() && ws.readyState === 1) ws.send(JSON.stringify({ type: 'url', url: f.url() })) })

  const s = { context, page, cdp, captured, flow, proving: false }
  sessions.set(ws, s)

  // Stream + signal ready BEFORE navigating: the real login page can be slow to
  // load from a datacenter, so the user watches it come up live instead of staring
  // at a blank pane while we await goto.
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 })
  ws.send(JSON.stringify({ type: 'ready', viewport: VIEWPORT, url: flow.loginUrl }))
  page.goto(flow.loginUrl, { waitUntil: 'commit', timeout: 45000 }).catch(() => {})
}

// map normalized (0..1) client coords → viewport pixels
const px = (n, dim) => Math.max(0, Math.min(dim, Math.round(n * dim)))

async function handleInput(s, m) {
  const { cdp } = s
  if (m.kind === 'mouse') {
    await cdp.send('Input.dispatchMouseEvent', {
      type: m.event, x: px(m.x, VIEWPORT.width), y: px(m.y, VIEWPORT.height),
      button: m.button || 'left', clickCount: m.event === 'mousePressed' || m.event === 'mouseReleased' ? 1 : 0,
      buttons: m.event === 'mouseMoved' && m.down ? 1 : 0,
    }).catch(() => {})
  } else if (m.kind === 'wheel') {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: px(m.x, VIEWPORT.width), y: px(m.y, VIEWPORT.height), deltaX: m.dx || 0, deltaY: m.dy || 0 }).catch(() => {})
  } else if (m.kind === 'key') {
    await cdp.send('Input.dispatchKeyEvent', {
      type: m.event, key: m.key, code: m.code, text: m.event === 'keyDown' ? m.text : undefined,
      windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode,
    }).catch(() => {})
  }
}

// ---- The proof: find the authenticated response, re-witness age >= N ---------
async function runProof(ws, s) {
  const send = (type, data) => { if (ws.readyState === 1) ws.send(JSON.stringify({ type, ...data })) }
  const flow = s.flow
  send('prove-step', { name: 'reading-session' })

  const hit = [...s.captured].reverse().find((c) => flow.detect.test(c.body))
  if (!hit) {
    send('prove-error', { message: 'Could not find your profile data yet. Log in fully and open your profile page, then try again.' })
    return
  }
  const { maxBirthYear, matchers } = buildAgePredicate(flow.minAge)
  const matcher = matchers.find((m) => new RegExp(m).test(hit.body))
  if (!matcher) {
    // A DOB is present but the birth year is too recent to guarantee the threshold.
    send('prove-result', { pass: false, reason: `Age does not clear ${flow.minAge}+ (born after ${maxBirthYear}).` })
    return
  }

  // Cookies + sensitive headers for the endpoint's host, to re-issue authenticated.
  const host = new URL(hit.url).hostname
  const cookies = await s.context.cookies()
  const cookieStr = cookies.filter((c) => host.endsWith(c.domain.replace(/^\./, ''))).map((c) => `${c.name}=${c.value}`).join('; ')
  const rh = hit.reqHeaders || {}
  const secretHeaders = {}
  for (const k of Object.keys(rh)) if (/^(authorization|x-.*|.*-token|.*-auth)$/i.test(k)) secretHeaders[k] = rh[k]
  const publicHeaders = {}
  for (const k of ['referer', 'accept', 'accept-language']) if (rh[k]) publicHeaders[k] = rh[k]

  const verity = new VerityClient()
  try {
    send('prove-step', { name: 'witnessing-tls' })
    const proof = await verity.prove({
      url: hit.url, method: hit.method || 'GET', headers: publicHeaders, match: matcher,
      secretParams: { cookieStr, headers: secretHeaders },
      onStep: (st) => send('prove-step', { name: st?.name || String(st) }),
    })
    send('prove-proof', { attestor: proof.attestor, identifier: proof.identifier })

    if (!relayer) { send('prove-error', { message: 'relayer not configured (set RELAYER_PRIVATE_KEY)' }); return }
    send('prove-step', { name: 'recording-onchain' })
    const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
    const tx = await contract.verifyAndRecord(toOnchainProof(proof))
    send('prove-tx', { hash: tx.hash, status: 'pending', explorer: `${EXPLORER}/tx/${tx.hash}` })
    const rc = await tx.wait()
    send('prove-result', { pass: true, question: flow.question, reveals: flow.reveals, hides: flow.hides,
      attestor: proof.attestor, identifier: proof.identifier,
      tx: tx.hash, block: Number(rc.blockNumber), explorer: `${EXPLORER}/tx/${tx.hash}` })
  } catch (e) {
    send('prove-error', { message: String(e?.shortMessage || e?.message || e) })
  } finally {
    await verity.close()
  }
}

async function destroy(ws) {
  const s = sessions.get(ws); sessions.delete(ws)
  if (!s) return
  try { await s.cdp.send('Page.stopScreencast').catch(() => {}) } catch { /* */ }
  try { await s.context.close() } catch { /* */ }
}

// ---- HTTP + WS wiring --------------------------------------------------------
const app = express()
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '2mb' }))
app.get('/api/flows', (_req, res) => res.json(flowList()))
app.get('/api/health', (_req, res) => res.json({ ok: true, sessions: sessions.size, relayer: !!relayer }))

// On-device capture endpoint: the Verity EXTENSION captures the user's session in
// their OWN browser (residential IP, real fingerprint — no bot wall) and posts the
// authenticated endpoint + session cookie here. We witness that request through the
// attestor with the cookie redacted and prove the age predicate (no DOB revealed).
app.post('/api/prove-session', async (req, res) => {
  const { flow: flowId, cookieStr, url, headers } = req.body || {}
  const flow = getFlow(flowId)
  if (!cookieStr || !url) return res.status(400).json({ error: 'cookieStr and url are required' })
  const { maxBirthYear, matchers } = buildAgePredicate(flow.minAge)
  const secretHeaders = {}
  if (headers && typeof headers === 'object') for (const k of Object.keys(headers)) if (/^(authorization|x-.*|.*-token)$/i.test(k)) secretHeaders[k] = headers[k]
  const verity = new VerityClient()
  try {
    let proof = null
    for (const m of matchers) {
      try { proof = await verity.prove({ url, match: m, secretParams: { cookieStr, headers: secretHeaders } }); break }
      catch { /* wrong DOB format or predicate not met — try the next serialisation */ }
    }
    if (!proof) return res.json({ pass: false, question: flow.question, reason: `Age does not clear ${flow.minAge}+ (born after ${maxBirthYear}), or the profile field could not be witnessed.` })
    let tx = null, block = null
    if (relayer) {
      const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
      const t = await contract.verifyAndRecord(toOnchainProof(proof)); const rc = await t.wait()
      tx = t.hash; block = Number(rc.blockNumber)
    }
    res.json({ pass: true, question: flow.question, reveals: flow.reveals, hides: flow.hides,
      attestor: proof.attestor, identifier: proof.identifier, tx, block, explorer: tx ? `${EXPLORER}/tx/${tx}` : null })
  } catch (e) {
    res.status(502).json({ error: String(e?.shortMessage || e?.message || e) })
  } finally { await verity.close() }
})

app.use(express.static(path.join(__dirname, 'public')))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/session' })
wss.on('connection', async (ws, req) => {
  const flowId = new URL(req.url, 'http://x').searchParams.get('flow')
  const flow = getFlow(flowId)
  ws.on('message', async (buf) => {
    const m = jsonParse(buf.toString()); if (!m) return
    const s = sessions.get(ws)
    try {
      if (m.type === 'input' && s) await handleInput(s, m)
      else if (m.type === 'back' && s) await s.page.goBack().catch(() => {})
      else if (m.type === 'prove' && s && !s.proving) { s.proving = true; await runProof(ws, s); s.proving = false }
    } catch (e) { ws.send(JSON.stringify({ type: 'prove-error', message: String(e?.message || e) })) }
  })
  ws.on('close', () => destroy(ws))
  ws.on('error', () => destroy(ws))
  try { await startSession(ws, flow) } catch (e) { ws.send(JSON.stringify({ type: 'prove-error', message: 'browser failed to start: ' + String(e?.message || e) })); ws.close() }
})

server.listen(PORT, () => console.log(`Verity remote-browser on http://localhost:${PORT} (relayer ${relayer ? 'on' : 'off'})`))
