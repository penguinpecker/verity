// Smoke test: prove a real value from a live public API against the Verity attestor,
// then verify the proof. Requires a Verity attestor reachable at VERITY_ATTESTOR_URL
// (defaults to ws://localhost:8001/ws).
import { VerityClient } from '../src/index.js'

const attestorUrl = process.env.VERITY_ATTESTOR_URL || 'ws://localhost:8001/ws'
const verity = new VerityClient({ attestorUrl })

console.log('Verity attestor :', attestorUrl)
console.log('app id (owner)  :', verity.appId)

const t0 = Date.now()
try {
  const proof = await verity.prove({
    url: 'https://api.wheretheiss.at/v1/satellites/25544',
    match: '"latitude":(?<latitude>-?[0-9.]+)',
    onStep: (s) => process.stdout.write(' .' + (s?.name || '')),
  })
  console.log(`\nproved in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log('proven data     :', JSON.stringify(proof.data))
  console.log('signed by       :', proof.attestor)
  console.log('identifier      :', proof.identifier)

  const ok = await verity.verify(proof)
  console.log('signature valid :', ok)

  await verity.close()
  process.exit(ok ? 0 : 1)
} catch (e) {
  console.error('\nFAILED:', e?.message || e)
  await verity.close()
  process.exit(1)
}
