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

app.get('/api/sources', (_req, res) => {
  res.json(Object.entries(SOURCES).map(([id, s]) => ({
    id, host: s.host, tag: s.tag, label: s.label, valueLabel: s.valueLabel, prefix: s.prefix,
  })))
})

app.get('/api/current', async (req, res) => {
  const s = getSource(req.query.source)
  try {
    const r = await fetch(s.url, { headers: { 'Accept-Encoding': 'identity', Accept: 'application/json' } })
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
    const proof = await verity.prove({ url: s.url, match: s.match, onStep: (st) => send('step', { name: st?.name || String(st) }) })
    const onchain = toOnchainProof(proof)
    send('proof', { value: proof.data.value, prefix: s.prefix, attestor: proof.attestor, identifier: proof.identifier })

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
