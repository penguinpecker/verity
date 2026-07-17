require('@nomicfoundation/hardhat-ethers')

// Deployer key comes from the environment; never commit it.
const PK = process.env.DEPLOYER_PRIVATE_KEY

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.28',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hardhat: {},
    // Horizen (ZEN) L3 on Base — testnet
    horizenTestnet: {
      url: 'https://horizen-testnet.rpc.caldera.xyz/http',
      chainId: 2651420,
      accounts: PK ? [PK] : [],
    },
    // Horizen (ZEN) L3 on Base — mainnet
    horizenMainnet: {
      url: 'https://horizen.calderachain.xyz/http',
      chainId: 26514,
      accounts: PK ? [PK] : [],
    },
  },
}
