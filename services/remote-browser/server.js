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
// The hosted browser lets a user log in with NO extension — but a citizen portal
// like myAadhaar refuses a datacenter IP (serves a blank page). Route egress
// through a residential / in-region proxy so the portal sees a real Indian IP.
// Credentials come from env ONLY (never committed): PROXY_SERVER (http[s]://host:port
// or socks5://host:port), PROXY_USERNAME, PROXY_PASSWORD.
const PROXY = process.env.PROXY_SERVER
  ? { server: process.env.PROXY_SERVER, username: process.env.PROXY_USERNAME || undefined, password: process.env.PROXY_PASSWORD || undefined }
  : null
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(PROXY ? { proxy: PROXY } : {}),
})
const sessions = new Map()

const jsonParse = (s) => { try { return JSON.parse(s) } catch { return null } }

const REGION = {
  IN: { locale: 'en-IN', timezoneId: 'Asia/Kolkata' },
  US: { locale: 'en-US', timezoneId: 'America/New_York' },
}

async function startSession(ws, flow, want) {
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

  const s = { context, page, cdp, captured, flow, want: want && want.length ? want : ['age'], proving: false }
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
  const want = s.want
  send('prove-step', { name: 'reading-session' })

  const hit = [...s.captured].reverse().find((c) => flow.detect.test(c.body))
  if (!hit) {
    send('prove-error', { message: 'Could not find your profile data yet. Log in fully and open your profile page, then try again.' })
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

  try {
    send('prove-step', { name: 'witnessing-tls' })
    const { gateFailed, maxBirthYear, out, ageProof } = await proveClaims({
      url: hit.url, method: hit.method || 'GET', publicHeaders,
      secretParams: { cookieStr, headers: secretHeaders }, flow, want,
      onStep: (st) => send('prove-step', { name: st?.name || String(st) }),
    })
    if (gateFailed) { send('prove-result', { pass: false, question: flow.question, reason: `Age does not clear ${flow.minAge}+ (born after ${maxBirthYear}).` }); return }
    if (!out.proofs.length) { send('prove-result', { pass: false, reason: 'None of the requested fields could be witnessed from your profile.' }); return }
    send('prove-proof', { attestor: out.proofs[0].attestor, identifier: out.proofs[0].identifier })

    let tx = null, block = null
    if (relayer && ageProof) {
      send('prove-step', { name: 'recording-onchain' })
      const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
      const t = await contract.verifyAndRecord(toOnchainProof(ageProof))
      send('prove-tx', { hash: t.hash, status: 'pending', explorer: `${EXPLORER}/tx/${t.hash}` })
      const rc = await t.wait(); tx = t.hash; block = Number(rc.blockNumber)
      const rec = out.proofs[0]; rec.tx = tx; rec.block = block; rec.explorer = `${EXPLORER}/tx/${tx}`
    }
    const wantsAge = want.includes('age')
    send('prove-result', {
      pass: wantsAge ? out.claims[`age_over_${flow.minAge}`] === true : out.missing.length === 0,
      question: wantsAge ? flow.question : undefined, reveals: wantsAge ? flow.reveals : undefined, hides: wantsAge ? flow.hides : undefined,
      claims: out.claims, proofs: out.proofs, missing: out.missing,
      attestor: out.proofs[0].attestor, identifier: out.proofs[0].identifier,
      tx, block, explorer: tx ? `${EXPLORER}/tx/${tx}` : null,
    })
  } catch (e) {
    send('prove-error', { message: String(e?.shortMessage || e?.message || e) })
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
// `proxy` reports only WHETHER an egress proxy is configured (never its value),
// so the demo can honestly show whether the hosted browser can reach a
// geo-restricted portal like myAadhaar.
app.get('/api/health', (_req, res) => res.json({ ok: true, sessions: sessions.size, relayer: !!relayer, proxy: !!PROXY }))

// On-device capture endpoint: the Verity EXTENSION captures the user's session in
// their OWN browser (residential IP, real fingerprint — no bot wall) and posts the
// authenticated endpoint + session cookie here. We witness that request through the
// attestor with the cookie redacted.
//
// `claims` selects what the requesting app receives (the user approves the list
// before the extension sends it):
//   'age'  → the no-capture age predicate: a single yes/no, DOB never revealed
//   'name' → the profile name, selectively disclosed via a capture group
//   'dob'  → the date of birth, selectively disclosed via a capture group
// Every claim is a separate real zkTLS proof over the same authenticated endpoint.
// ONLY the age-predicate proof is ever recorded on-chain: its matcher has no
// capture group, so its calldata carries no PII. Disclosure proofs (name/dob)
// embed the revealed value in claim.context — recording one would publish the
// user's name/DOB in permanent public calldata, so they stay off-chain
// (attestor-signed, server-verifiable).
const normalizeClaims = (claims, flow) => {
  const want = new Set(), unsupported = []
  for (const c of claims) {
    const k = String(c).toLowerCase()
    if (k === 'age' || k === `age_over_${flow.minAge}`) want.add('age')
    else if (k === 'name' || k === 'dob') want.add(k)
    else unsupported.push(String(c))
  }
  return { want: [...want], unsupported }
}

// A transport failure (attestor unreachable, TLS/socket error, timeout) must NOT
// be treated as "predicate not met" — that would present an outage as a NO
// verdict. Only claim rejections may fall through to the next matcher.
const isTransportError = (e) => {
  const code = String(e?.code || e?.data?.code || '')
  if (/NETWORK|TIMEOUT/i.test(code)) return true
  return /timed? ?out|network|socket|websocket|connection|ECONN|ENOTFOUND|EAI_AGAIN/i.test(String(e?.message || e))
}

// Shared claims prover used by BOTH the extension backend (/api/prove-session)
// and the hosted-browser flow (runProof). Proves each requested claim as a
// separate real zkTLS proof over the same authenticated endpoint, and returns
// the age-predicate proof separately as the ONLY proof eligible for on-chain
// recording (disclosure proofs carry the plaintext value in claim.context, so
// recording one would leak PII into public calldata). Transport errors propagate.
async function proveClaims({ url, method = 'GET', publicHeaders = {}, secretParams, flow, want, onStep }) {
  const ageKey = `age_over_${flow.minAge}`
  const wantsAge = want.includes('age')
  const verity = new VerityClient()
  const tryMatchers = async (list) => {
    for (const m of list) {
      try { return await verity.prove({ url, method, headers: publicHeaders, match: m, secretParams, onStep }) }
      catch (e) { if (isTransportError(e)) throw e /* else serialisation/predicate mismatch — next */ }
    }
    return null
  }
  try {
    const out = { claims: {}, proofs: [], missing: [] }
    let ageProof = null
    if (wantsAge) {
      const { maxBirthYear, matchers } = buildAgePredicate(flow.minAge)
      ageProof = await tryMatchers(matchers)
      if (!ageProof) return { gateFailed: true, maxBirthYear, out, ageProof: null }
      out.claims[ageKey] = true
      out.proofs.push({ claim: ageKey, attestor: ageProof.attestor, identifier: ageProof.identifier })
    }
    for (const field of want.filter((w) => w !== 'age')) {
      const proof = await tryMatchers(flow.fields?.[field] || [])
      if (!proof) { out.missing.push(field); continue }
      out.claims[field] = proof.data[field]
      out.proofs.push({ claim: field, attestor: proof.attestor, identifier: proof.identifier })
    }
    return { gateFailed: false, out, ageProof }
  } finally { await verity.close() }
}

app.post('/api/prove-session', async (req, res) => {
  const { flow: flowId, cookieStr, url, headers, claims } = req.body || {}
  const flow = getFlow(flowId)
  if (!cookieStr || !url) return res.status(400).json({ error: 'cookieStr and url are required' })
  if (claims !== undefined && !Array.isArray(claims)) return res.status(400).json({ error: 'claims must be an array' })
  const { want, unsupported } = normalizeClaims(Array.isArray(claims) && claims.length ? claims : ['age'], flow)
  if (unsupported.length) {
    return res.status(400).json({ error: `unsupported claims for this flow: ${unsupported.join(', ')} — use any of: age (age_over_${flow.minAge}), name, dob` })
  }

  const secretHeaders = {}
  if (headers && typeof headers === 'object') for (const k of Object.keys(headers)) if (/^(authorization|x-.*|.*-token)$/i.test(k)) secretHeaders[k] = headers[k]
  const ageKey = `age_over_${flow.minAge}`
  const wantsAge = want.includes('age')
  // question/reveals/hides describe the age gate — only meaningful when it was requested.
  const gateText = wantsAge ? { question: flow.question, reveals: flow.reveals, hides: flow.hides } : {}

  try {
    const { gateFailed, maxBirthYear, out, ageProof } = await proveClaims({
      url, secretParams: { cookieStr, headers: secretHeaders }, flow, want,
    })
    if (gateFailed) {
      // The gate failed: the fields below were never attempted, so they are NOT
      // "missing" — missing is reserved for attempted-but-unwitnessable.
      return res.json({ pass: false, ...gateText, claims: {}, proofs: [], missing: [],
        reason: `${ageKey.replace(/_/g, ' ')} not provable (born after ${maxBirthYear}), or the profile field could not be witnessed.` })
    }
    if (!out.proofs.length) {
      return res.json({ pass: false, ...gateText, claims: {}, proofs: [], missing: out.missing,
        reason: 'None of the requested fields could be witnessed from the profile response.' })
    }

    let tx = null, block = null
    if (relayer && ageProof) {
      const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
      const t = await contract.verifyAndRecord(toOnchainProof(ageProof)); const rc = await t.wait()
      tx = t.hash; block = Number(rc.blockNumber)
      const rec = out.proofs[0]; rec.tx = tx; rec.block = block; rec.explorer = `${EXPLORER}/tx/${tx}`
    }

    // `pass`: with the age gate requested it reports the gate; for disclosure-only
    // requests it means "everything requested was witnessed". Top-level
    // attestor/identifier/tx mirror the first proof for the popup UI.
    res.json({ pass: wantsAge ? out.claims[ageKey] === true : out.missing.length === 0,
      ...gateText,
      claims: out.claims, proofs: out.proofs, missing: out.missing,
      attestor: out.proofs[0].attestor, identifier: out.proofs[0].identifier,
      tx, block, explorer: tx ? `${EXPLORER}/tx/${tx}` : null })
  } catch (e) {
    res.status(502).json({ error: String(e?.shortMessage || e?.message || e) })
  }
})

app.use(express.static(path.join(__dirname, 'public')))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/session' })
wss.on('connection', async (ws, req) => {
  const u = new URL(req.url, 'http://x')
  const flow = getFlow(u.searchParams.get('flow'))
  const claimsParam = (u.searchParams.get('claims') || 'age').split(',').map((c) => c.trim()).filter(Boolean)
  const { want } = normalizeClaims(claimsParam, flow)
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
  try { await startSession(ws, flow, want.length ? want : ['age']) } catch (e) { ws.send(JSON.stringify({ type: 'prove-error', message: 'browser failed to start: ' + String(e?.message || e) })); ws.close() }
})

server.listen(PORT, () => console.log(`Verity remote-browser on http://localhost:${PORT} (relayer ${relayer ? 'on' : 'off'})`))
