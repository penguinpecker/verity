// Deploy VerityVerifier on the in-process Hardhat network and check it verifies a
// REAL attestor-signed proof (positive), and rejects a tampered claim and an
// untrusted attestor (negatives). Run: npm run verify:local
const hre = require('hardhat')
const fs = require('fs')
const path = require('path')

async function main() {
  const { ethers } = hre
  const fixturePath = path.join(__dirname, '..', 'test', 'fixtures', 'onchain-proof.json')
  if (!fs.existsSync(fixturePath)) {
    throw new Error('fixture missing — run: node scripts/gen-fixture.mjs (needs a running attestor)')
  }
  const { proof, attestor, data } = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  console.log('proven data    :', JSON.stringify(data))
  console.log('signed by      :', attestor)

  const Verifier = await ethers.getContractFactory('VerityVerifier')
  const verifier = await Verifier.deploy([attestor])
  await verifier.waitForDeployment()
  console.log('verifier at    :', await verifier.getAddress())

  // positive
  const ok = await verifier.isValidProof(proof)
  console.log('real proof     :', ok ? 'VALID ✓' : 'INVALID ✗')
  if (!ok) throw new Error('FAIL: real proof did not verify on-chain')
  const okStatic = await verifier.verifyProof.staticCall(proof)
  if (!okStatic) throw new Error('FAIL: verifyProof returned false')

  // negative 1: tamper the signed identifier
  const tampered = JSON.parse(JSON.stringify(proof))
  tampered.signedClaim.claim.identifier = '0x' + '00'.repeat(32)
  const bad1 = await verifier.isValidProof(tampered)
  console.log('tampered claim :', bad1 === false ? 'rejected ✓' : 'ACCEPTED ✗')
  if (bad1) throw new Error('FAIL: tampered proof verified')

  // negative 2: verifier that trusts a different attestor
  const stranger = ethers.Wallet.createRandom().address
  const v2 = await (await ethers.getContractFactory('VerityVerifier')).deploy([stranger])
  await v2.waitForDeployment()
  const bad2 = await v2.isValidProof(proof)
  console.log('wrong attestor :', bad2 === false ? 'rejected ✓' : 'ACCEPTED ✗')
  if (bad2) throw new Error('FAIL: proof verified under an untrusted attestor')

  console.log('\nALL ON-CHAIN CHECKS PASSED — VerityVerifier verifies real proofs and rejects forgeries.')
}

main().catch((e) => { console.error(e); process.exit(1) })
