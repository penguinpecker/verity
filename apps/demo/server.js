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

const SOURCE_URL = 'https://api.kraken.com/0/public/Ticker?pair=ETHUSD'
const PRICE_MATCH = '"c":\\["(?<price>[0-9.]+)"'

app.use(express.static(path.join(__dirname, 'public')))

// Live price for the on-screen readout (this is display only — the proof is the real thing).
app.get('/api/price', async (_req, res) => {
  try {
    const r = await fetch(SOURCE_URL, { headers: { 'Accept-Encoding': 'identity', Accept: 'application/json' } })
    const j = await r.json()
    const price = j?.result?.XETHZUSD?.c?.[0]
    res.json({ price })
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
      match: PRICE_MATCH,
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
