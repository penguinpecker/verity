// Verity demo server.
// - GET /api/price : current ETH/USD from Kraken (server-fetched, for the live readout)
// - GET /api/prove : Server-Sent Events streaming the REAL zkTLS proof steps, then the proof
//                    (contract-ready), generated against the live Verity attestor.
// The browser then verifies that proof on Horizen mainnet itself (see public/app.js).
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { JsonRpcProvider, Wallet, Contract } from 'ethers'
import { VerityClient, toOnchainProof } from '../../packages/sdk/src/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 4000

// Real, India-relevant, uncompressed source: ESPN's IPL cricket scoreboard.
const SOURCE_URL = 'https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard'
const PROVE_MATCH = '"score":"(?<score>[0-9]+/[0-9]+)' // first team's runs/wickets, e.g. 161/5

// On-chain: submit a REAL verifyAndRecord() transaction to the Horizen-mainnet verifier.
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const HORIZEN_RPC = 'https://horizen.calderachain.xyz/http'
const EXPLORER = 'https://explorer.horizen.io'
const VERIFY_ABI = [
  'function verifyAndRecord(((string provider,string parameters,string context) claimInfo,((bytes32 identifier,address owner,uint32 timestampS,uint32 epoch) claim,bytes[] signatures) signedClaim) proof) returns (uint256)',
]
const relayer = process.env.RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RELAYER_PRIVATE_KEY, new JsonRpcProvider(HORIZEN_RPC, 26514))
  : null

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
    const onchain = toOnchainProof(proof)
    send('proof', {
      data: proof.data,
      attestor: proof.attestor,
      identifier: proof.identifier,
    })

    // Submit a REAL on-chain transaction: the contract re-verifies the attestor
    // signature and records the proof, emitting ProofVerified. Produces a tx hash.
    if (relayer) {
      send('step', { name: 'submitting-tx' })
      const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
      const tx = await contract.verifyAndRecord(onchain)
      send('tx', { hash: tx.hash, status: 'pending', explorer: `${EXPLORER}/tx/${tx.hash}` })
      const rc = await tx.wait()
      send('tx', {
        hash: tx.hash,
        status: 'confirmed',
        block: Number(rc.blockNumber),
        explorer: `${EXPLORER}/tx/${tx.hash}`,
      })
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

app.listen(PORT, () => {
  console.log(`Verity demo on http://localhost:${PORT}`)
})
