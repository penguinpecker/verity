// Verity demo server.
// - GET /api/price : current ETH/USD from Kraken (server-fetched, for the live readout)
// - GET /api/prove : Server-Sent Events streaming the REAL zkTLS proof steps, then the proof
//                    (contract-ready), generated against the live Verity attestor.
// The browser then verifies that proof on Horizen mainnet itself (see public/app.js).
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { VerityClient, toOnchainProof } from '../../packages/sdk/src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4000

// Real, India-relevant, uncompressed source: ESPN's IPL cricket scoreboard.
const SOURCE_URL = 'https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard'
const PROVE_MATCH = '"score":"(?<score>[0-9]+/[0-9]+)' // first team's runs/wickets, e.g. 161/5

// Allow the Vercel-hosted frontend to call this proving API cross-origin.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

app.use(express.static(path.join(__dirname, 'public')))

// Current match summary for the on-screen readout (display only — the proof is the real thing).
app.get('/api/current', async (_req, res) => {
  try {
    const r = await fetch(SOURCE_URL, { headers: { 'Accept-Encoding': 'identity', Accept: 'application/json' } })
    const j = await r.json()
    const e = j?.events?.[0]
    const comp = e?.competitions?.[0]
    res.json({
      match: e?.shortName,
      name: e?.name,
      status: comp?.status?.type?.description,
      teams: (comp?.competitors || []).map((c) => ({ name: c.team?.displayName, score: c.score })),
    })
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) })
  }
})

// Stream the real proof generation, step by step.
app.get('/api/prove', async (_req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.flushHeaders?.()
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const verity = new VerityClient()
  send('meta', { source: SOURCE_URL, attestorUrl: verity.attestorUrl })
  try {
    const proof = await verity.prove({
      url: SOURCE_URL,
      match: PROVE_MATCH,
      onStep: (s) => send('step', { name: s?.name || String(s) }),
    })
    send('proof', {
      data: proof.data,
      attestor: proof.attestor,
      identifier: proof.identifier,
      onchainProof: toOnchainProof(proof),
    })
  } catch (e) {
    send('error', { message: String(e?.message || e) })
  } finally {
    await verity.close()
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`Verity demo on http://localhost:${PORT}`)
})
