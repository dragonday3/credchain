import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * Hardhat Ignition deployment module for CredentialRegistry.
 *
 * This is the recommended (Step 3) deployment path for this project: Ignition tracks
 * deployments per network in `ignition/deployments/`, is idempotent (re-running a completed
 * deployment is a no-op), and integrates with `@nomicfoundation/hardhat-verify` for Etherscan
 * verification. The contract takes no constructor arguments — the deployer becomes the
 * contract administrator automatically (see `CredentialRegistry`'s constructor).
 *
 * Usage (local simulated network — safe to run any time):
 *   npx hardhat ignition deploy ignition/modules/CredentialRegistry.ts
 *
 * Usage (Sepolia — Step 3 only, requires SEPOLIA_RPC_URL / PRIVATE_KEY, see .env.example):
 *   npx hardhat ignition deploy ignition/modules/CredentialRegistry.ts --network sepolia --verify
 */
export default buildModule("CredentialRegistryModule", (m) => {
  const credentialRegistry = m.contract("CredentialRegistry", []);

  return { credentialRegistry };
});
