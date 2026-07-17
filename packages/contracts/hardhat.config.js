require('@nomicfoundation/hardhat-ethers')
require('@nomicfoundation/hardhat-verify')

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
  // Blockscout-based source verification for the Horizen explorer.
  etherscan: {
    apiKey: { horizenMainnet: 'blockscout' },
    customChains: [
      {
        network: 'horizenMainnet',
        chainId: 26514,
        urls: {
          apiURL: 'https://horizen.calderaexplorer.xyz/api',
          browserURL: 'https://explorer.horizen.io',
        },
      },
    ],
  },
  sourcify: { enabled: false },
}
