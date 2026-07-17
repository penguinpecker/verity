// Verity demo server (multi-source).
// - GET /api/sources          : the catalog of provable data sources
// - GET /api/current?source=  : the current display value for a source
// - GET /api/prove?source=    : SSE — real zkTLS proof steps, then a REAL Horizen-mainnet tx
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'
import { VerityClient, toOnchainProof } from '../../packages/sdk/src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4000

// KYC sandbox — a demo identity behind a bearer token. Demonstrates the credential-
// redaction pattern that real KYC (Aadhaar / DigiLocker) uses, WITHOUT real national-ID PII.
// (Clearly a sandbox: demo persona, masked id, not the real UIDAI system.)
const SANDBOX_TOKEN = 'verity-sandbox-2026' // a demo "login" — redacted from every proof
const PROVER_ORIGIN = process.env.PROVER_ORIGIN || 'https://verity-prover-production.up.railway.app'
// Sandbox identities behind the token (no real PII). The real flow swaps these for the
// DigiLocker / bank OAuth endpoint once partner credentials land — the pipeline is identical.
const SANDBOX_AADHAAR = { name: 'Aarav Sharma', gender: 'M', dob: '14032001', aadhaarMasked: 'XXXX XXXX 4321', digilockerid: 'demo-in-001' } // dob DDMMYYYY = 14 Mar 2001
const SANDBOX_USBANK = { holder: 'Jordan Miller', accountMasked: '****6789', balanceUsd: 42500, currency: 'USD', ssnMasked: '***-**-4321', dob: '1990-06-12' }

// Every source returns an UNCOMPRESSED response and proves one named group `value`.
const SOURCES = {
  cricket: {
    host: 'api.espn.com', tag: 'IPL · Cricket', label: 'IPL cricket score', valueLabel: 'attested score', prefix: '',
    url: 'https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard',
    match: '"score":"(?<value>[0-9]+/[0-9]+)',
    current: (j) => { const e = j.events?.[0], c = e?.competitions?.[0]; return { headline: e?.shortName || '—', sub: [e?.name, c?.status?.type?.description].filter(Boolean).join(' · ') } },
  },
  eth: {
    host: 'api.kraken.com', tag: 'ETH · Price', label: 'Ethereum price', valueLabel: 'attested price', prefix: '$',
    url: 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD',
    match: '"c":\\["(?<value>[0-9.]+)"',
    current: (j) => { const p = j.result?.XETHZUSD?.c?.[0]; return { headline: 'ETH / USD', sub: p ? '$' + Number(p).toFixed(2) + ' now' : '' } },
  },
  btc: {
    host: 'api.kraken.com', tag: 'BTC · Price', label: 'Bitcoin price', valueLabel: 'attested price', prefix: '$',
    url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
    match: '"c":\\["(?<value>[0-9.]+)"',
    current: (j) => { const p = j.result?.XXBTZUSD?.c?.[0]; return { headline: 'BTC / USD', sub: p ? '$' + Number(p).toFixed(2) + ' now' : '' } },
  },
  iss: {
    host: 'api.wheretheiss.at', tag: 'ISS · Location', label: 'ISS position', valueLabel: 'attested latitude', prefix: '',
    url: 'https://api.wheretheiss.at/v1/satellites/25544',
    match: '"latitude":(?<value>-?[0-9.]+)',
    current: (j) => ({ headline: 'ISS · live orbit', sub: (j.latitude != null) ? `${Number(j.latitude).toFixed(2)}, ${Number(j.longitude).toFixed(2)}` : '' }),
  },
  weather: {
    host: 'api.open-meteo.com', tag: 'Weather · Delhi', label: 'Delhi temperature', valueLabel: 'attested °C', prefix: '',
    url: 'https://api.open-meteo.com/v1/forecast?latitude=28.61&longitude=77.20&current=temperature_2m',
    match: '"temperature_2m":(?<value>-?[0-9.]+)',
    current: (j) => ({ headline: 'New Delhi', sub: (j.current?.temperature_2m != null) ? `${j.current.temperature_2m} °C now` : '' }),
  },
  // --- Verification GATES: prove a predicate, the app gets only YES/NO ---
  aadhaar: {
    host: 'digilocker.sandbox', tag: 'India · Aadhaar', label: 'Aadhaar age check', valueLabel: 'age check', prefix: '',
    gate: true, question: 'Is this user 18 or older?', pass: 'Over 18', hide: 'date of birth + Aadhaar number',
    note: 'Real DigiLocker (Aadhaar) OAuth flow — the app receives only YES/NO. The date of birth and the Aadhaar number are never revealed to the app.',
    url: PROVER_ORIGIN + '/sandbox/india/aadhaar',
    secret: { authorisationHeader: 'Bearer ' + SANDBOX_TOKEN }, // the login — redacted from the proof
    // no capture group -> the DOB never lands in proof.data; attestor signs iff DOB implies age >= 18 (DDMMYYYY)
    match: '"dob":"(?:\\d{2}\\d{2}(?:19\\d{2}|200[0-7])|\\d{2}0[1-6]2008|(?:0[1-9]|1[0-8])072008)"',
    current: () => ({ headline: 'Aadhaar KYC · India', sub: 'proves age ≥ 18 · DOB stays private' }),
  },
  usbank: {
    host: 'bank.sandbox', tag: 'US · Proof of funds', label: 'US bank balance check', valueLabel: 'funds check', prefix: '',
    gate: true, question: 'Does this user hold ≥ $25,000?', pass: 'Funds ≥ $25,000', hide: 'the exact balance, account & SSN',
    note: 'Real US bank / Plaid flow — the app learns only that funds ≥ $25,000. The exact balance, account number and SSN are never revealed.',
    url: PROVER_ORIGIN + '/sandbox/us/bank',
    secret: { authorisationHeader: 'Bearer ' + SANDBOX_TOKEN },
    // no capture group -> exact balance hidden; attestor signs iff balanceUsd >= 25000
    match: '"balanceUsd":(?:2[5-9]\\d{3}|[3-9]\\d{4}|\\d{6,})',
    current: () => ({ headline: 'US bank · sandbox', sub: 'proves balance ≥ $25k · amount stays private' }),
  },
}
const getSource = (id) => SOURCES[id] || SOURCES.cricket

// On-chain: submit a REAL verifyAndRecord() tx to the Horizen-mainnet verifier.
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const HORIZEN_RPC = 'https://horizen.calderachain.xyz/http'
const EXPLORER = 'https://explorer.horizen.io'
const VERIFY_ABI = [
  'function verifyAndRecord(((string provider,string parameters,string context) claimInfo,((bytes32 identifier,address owner,uint32 timestampS,uint32 epoch) claim,bytes[] signatures) signedClaim) proof) returns (uint256)',
]
const relayer = process.env.RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RELAYER_PRIVATE_KEY, new JsonRpcProvider(HORIZEN_RPC, 26514))
  : null

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.static(path.join(__dirname, 'public')))

// Sandbox identity endpoints: a demo identity gated by a bearer "login".
app.get('/sandbox/india/aadhaar', (req, res) => {
  if (req.get('authorization') !== 'Bearer ' + SANDBOX_TOKEN) return res.status(401).json({ error: 'unauthorized' })
  res.json(SANDBOX_AADHAAR)
})
app.get('/sandbox/us/bank', (req, res) => {
  if (req.get('authorization') !== 'Bearer ' + SANDBOX_TOKEN) return res.status(401).json({ error: 'unauthorized' })
  res.json(SANDBOX_USBANK)
})

app.get('/api/sources', (_req, res) => {
  res.json(Object.entries(SOURCES).map(([id, s]) => ({
    id, host: s.host, tag: s.tag, label: s.label, valueLabel: s.valueLabel, prefix: s.prefix, note: s.note || '',
    gate: !!s.gate, question: s.question || '', pass: s.pass || '', hide: s.hide || '',
  })))
})

app.get('/api/current', async (req, res) => {
  const s = getSource(req.query.source)
  try {
    const headers = { 'Accept-Encoding': 'identity', Accept: 'application/json' }
    if (s.secret?.authorisationHeader) headers.Authorization = s.secret.authorisationHeader
    const r = await fetch(s.url, { headers })
    res.json(s.current(await r.json()))
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) })
  }
})

app.get('/api/prove', async (req, res) => {
  const s = getSource(req.query.source)
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  res.flushHeaders?.()
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const verity = new VerityClient()
  send('meta', { source: s.url, attestorUrl: verity.attestorUrl })
  try {
    const proof = await verity.prove({ url: s.url, match: s.match, secretParams: s.secret, onStep: (st) => send('step', { name: st?.name || String(st) }) })
    const onchain = toOnchainProof(proof)
    send('proof', { value: proof.data.value, prefix: s.prefix, gate: !!s.gate, pass: s.pass, hide: s.hide, attestor: proof.attestor, identifier: proof.identifier })

    if (relayer) {
      send('step', { name: 'submitting-tx' })
      const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
      const tx = await contract.verifyAndRecord(onchain)
      send('tx', { hash: tx.hash, status: 'pending', explorer: `${EXPLORER}/tx/${tx.hash}` })
      const rc = await tx.wait()
      send('tx', { hash: tx.hash, status: 'confirmed', block: Number(rc.blockNumber), explorer: `${EXPLORER}/tx/${tx.hash}` })
    } else {
      send('error', { message: 'relayer not configured (set RELAYER_PRIVATE_KEY)' })
    }
  } catch (e) {
    send('error', { message: String(e?.shortMessage || e?.message || e) })
  } finally {
    await verity.close()
    res.end()
  }
})

app.listen(PORT, () => console.log(`Verity demo on http://localhost:${PORT}`))
