// Generate a REAL proof via @verity/sdk and save the on-chain tuple as a fixture,
// used by verify-local.js to test the verifier against a genuine attestor signature.
import { VerityClient, toOnchainProof } from '../../sdk/src/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const attestorUrl = process.env.VERITY_ATTESTOR_URL || 'ws://localhost:8001/ws'

const verity = new VerityClient({ attestorUrl })
console.log('attestor:', attestorUrl)
const proof = await verity.prove({
  url: 'https://api.wheretheiss.at/v1/satellites/25544',
  match: '"latitude":(?<latitude>-?[0-9.]+)',
  onStep: (s) => process.stdout.write(' .' + (s?.name || '')),
})
const onchain = toOnchainProof(proof)
const dir = path.join(__dirname, '..', 'test', 'fixtures')
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(
  path.join(dir, 'onchain-proof.json'),
  JSON.stringify({ proof: onchain, attestor: proof.attestor, data: proof.data }, null, 2)
)
console.log('\nwrote test/fixtures/onchain-proof.json')
console.log('attestor:', proof.attestor, '| data:', JSON.stringify(proof.data))
await verity.close()
