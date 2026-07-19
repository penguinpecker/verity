// Vercel serverless function — the Aadhaar rail's verify + re-attest, stateless so
// it runs on Vercel (no persistent server, unlike the hosted browser).
//   1. verify the in-browser Anon Aadhaar proof (Groth16 + UIDAI public-key hash),
//   2. re-attest a yes/no as a Verity attestor-signed claim,
//   3. record it on the Horizen verifier — the same on-chain layer every rail uses.
import { init, verify, deserialize, artifactUrls, ArtifactsOrigin } from '@anon-aadhaar/core'
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } from 'ethers'

const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const HORIZEN_RPC = 'https://horizen.calderachain.xyz/http'
const EXPLORER = 'https://explorer.horizen.io'
const VERIFY_ABI = ['function verifyAndRecord(((string provider,string parameters,string context) claimInfo,((bytes32 identifier,address owner,uint32 timestampS,uint32 epoch) claim,bytes[] signatures) signedClaim) proof) returns (uint256)']
const ATTESTOR_KEY = process.env.VERITY_ATTESTOR_KEY || null
const relayer = process.env.RELAYER_PRIVATE_KEY
  ? new Wallet(process.env.RELAYER_PRIVATE_KEY, new JsonRpcProvider(HORIZEN_RPC, 26514))
  : null

// Init the Anon Aadhaar verifier once per warm lambda.
let initPromise = null
const ensureInit = () => (initPromise ??= init({
  wasmURL: artifactUrls.v2.wasm, zkeyURL: artifactUrls.v2.zkey,
  vkeyURL: artifactUrls.v2.vk, artifactsOrigin: ArtifactsOrigin.server,
}))

// Mint an attestor-signed Verity claim, byte-compatible with Claims.serialise().
async function mintSignedProof({ provider, parameters, context, epoch = 1 }) {
  const wallet = new Wallet(ATTESTOR_KEY)
  const params = JSON.stringify(parameters)
  const ctx = JSON.stringify(context || {})
  const ts = Math.floor(Date.now() / 1000)
  const owner = wallet.address.toLowerCase()
  const identifier = keccak256(toUtf8Bytes(`${provider}\n${params}\n${ctx}`))
  const serialised = `${identifier}\n${owner}\n${ts}\n${epoch}`
  const sig = await wallet.signMessage(serialised)
  return {
    attestor: wallet.address, identifier,
    proof: {
      claimInfo: { provider, parameters: params, context: ctx },
      signedClaim: { claim: { identifier, owner, timestampS: ts, epoch }, signatures: [sig] },
    },
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })

  await ensureInit()
  const { proofs, testMode } = req.body || {}
  const entry = Array.isArray(proofs) ? proofs[0] : proofs
  const serialized = entry && (entry.pcd || entry.proof || entry)
  if (!serialized) return res.status(400).json({ error: 'no Anon Aadhaar proof supplied' })

  let pcd
  try { pcd = await deserialize(typeof serialized === 'string' ? serialized : JSON.stringify(serialized)) }
  catch (e) { return res.status(400).json({ error: 'could not parse proof: ' + String(e?.message || e) }) }

  let ok
  try { ok = await verify(pcd, !!testMode) }
  catch (e) { return res.status(200).json({ pass: false, reason: String(e?.message || e) }) }
  if (!ok) return res.status(200).json({ pass: false, reason: 'invalid Anon Aadhaar proof' })
  if (pcd.proof.ageAbove18 !== '1') {
    return res.status(200).json({ pass: false, question: 'Is this person 18 or older?', reason: 'age is not above 18' })
  }

  let attestor = null, identifier = null, tx = null, block = null
  try {
    if (ATTESTOR_KEY) {
      const minted = await mintSignedProof({
        provider: 'verity-aadhaar', parameters: { claim: 'age_over_18', value: true },
        context: { rail: 'anon-aadhaar', nullifier: pcd.proof.nullifier, test: !!testMode },
      })
      attestor = minted.attestor; identifier = minted.identifier
      if (relayer) {
        const contract = new Contract(VERIFIER, VERIFY_ABI, relayer)
        const t = await contract.verifyAndRecord(minted.proof); const rc = await t.wait()
        tx = t.hash; block = Number(rc.blockNumber)
      }
    }
  } catch (e) {
    return res.status(502).json({ error: 'attest/record failed: ' + String(e?.shortMessage || e?.message || e) })
  }

  res.status(200).json({
    pass: true, question: 'Is this person 18 or older?', claims: { age_over_18: true },
    proofs: [{ claim: 'age_over_18', rail: 'anon-aadhaar', attestor, identifier, tx, block, explorer: tx ? `${EXPLORER}/tx/${tx}` : null }],
    nullifier: pcd.proof.nullifier, recorded: !!tx,
    attestor, tx, block, explorer: tx ? `${EXPLORER}/tx/${tx}` : null,
  })
}
