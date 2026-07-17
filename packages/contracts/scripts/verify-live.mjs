import { VerityClient, toOnchainProof } from '../../sdk/src/index.js'
import { JsonRpcProvider, Contract } from 'ethers'
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VERIFIER = '0x85804b684Ce86AC1773950161886741862EE9DBB'
const abi = JSON.parse(fs.readFileSync(path.join(__dirname,'..','artifacts','contracts','VerityVerifier.sol','VerityVerifier.json'),'utf8')).abi

// 1) real proof from the LIVE Railway attestor (SDK default)
const verity = new VerityClient()
console.log('proving against live attestor:', verity.attestorUrl)
const proof = await verity.prove({ url:'https://api.wheretheiss.at/v1/satellites/25544', match:'"latitude":(?<latitude>-?[0-9.]+)' })
console.log('proven data :', JSON.stringify(proof.data), '| signed by', proof.attestor)
await verity.close()

// 2) verify it against the LIVE Horizen-mainnet contract
const provider = new JsonRpcProvider('https://horizen.calderachain.xyz/http', 26514)
const c = new Contract(VERIFIER, abi, provider)
const onchain = toOnchainProof(proof)
const ok = await c.isValidProof(onchain)
console.log('\nHorizen mainnet VerityVerifier', VERIFIER)
console.log('isValidProof(real proof) =>', ok, ok ? '✓ VERIFIED ON-CHAIN' : '✗')
console.log('trusts attestor          =>', await c.isAttestor(proof.attestor))
