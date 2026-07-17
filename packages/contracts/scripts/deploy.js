// Deploy VerityVerifier to the selected network, trusting the given attestor address(es).
//   VERITY_ATTESTORS=0xAttestor1,0xAttestor2 DEPLOYER_PRIVATE_KEY=0x.. \
//     npm run deploy:horizen-testnet
const hre = require('hardhat')

async function main() {
  const { ethers } = hre
  const attestors = (process.env.VERITY_ATTESTORS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  if (attestors.length === 0) {
    throw new Error('set VERITY_ATTESTORS=0xAttestor1[,0xAttestor2] (the attestor signing address)')
  }

  const net = await ethers.provider.getNetwork()
  const [deployer] = await ethers.getSigners()
  const bal = await ethers.provider.getBalance(deployer.address)
  console.log('network   :', hre.network.name, '(chainId', net.chainId.toString() + ')')
  console.log('deployer  :', deployer.address)
  console.log('balance   :', ethers.formatEther(bal), 'ETH')
  if (bal === 0n) {
    throw new Error(`deployer has 0 ETH on ${hre.network.name}. Fund ${deployer.address} (Horizen gas is ETH) via hub-testnet.horizen.io, then retry.`)
  }
  console.log('attestors :', attestors.join(', '))

  const Verifier = await ethers.getContractFactory('VerityVerifier')
  const verifier = await Verifier.deploy(attestors)
  await verifier.waitForDeployment()
  const addr = await verifier.getAddress()
  console.log('\nVerityVerifier deployed at:', addr)
  console.log('explorer: check the block explorer for this network')
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
