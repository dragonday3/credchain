import "dotenv/config";

import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";

// @nomicfoundation/hardhat-verify ships bundled inside the ethers+mocha toolbox above,
// so it is only configured here (via the `verify` key), never re-added to `plugins`.
export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
      },
      production: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    // Step 3 (deployment) target. Not used yet — no deployment is performed as part of
    // Step 2. Values are read from environment variables (see .env.example); an env var
    // always takes precedence over Hardhat's encrypted keystore, so either
    // `npx hardhat keystore set SEPOLIA_RPC_URL` or a local `.env` file will work.
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY"),
    },
  },
});
