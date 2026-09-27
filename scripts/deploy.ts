import { network } from "hardhat";

/**
 * Simple, imperative deployment script for CredentialRegistry.
 *
 * This is a companion to the Hardhat Ignition module at
 * `ignition/modules/CredentialRegistry.ts`, which is the recommended way to deploy this
 * project (idempotent, tracks deployments per network, integrates with `hardhat verify`).
 * This script is provided as a simpler, explicit alternative for anyone who wants to read a
 * straight-line deployment flow.
 *
 * Not run as part of Step 2. Intended for Step 3, against the `sepolia` network configured in
 * hardhat.config.ts (see .env.example for the required environment variables).
 *
 *   npx hardhat run scripts/deploy.ts --network sepolia
 */
async function main(): Promise<void> {
  const { ethers } = await network.create();
  const [deployer] = await ethers.getSigners();

  console.log(`Deploying CredentialRegistry with account: ${deployer.address}`);

  const registry = await ethers.deployContract("CredentialRegistry");
  await registry.waitForDeployment();

  const address = await registry.getAddress();
  console.log(`CredentialRegistry deployed to: ${address}`);
  console.log(`Contract administrator (owner): ${await registry.owner()}`);
  console.log(
    `\nNext step (Etherscan verification): npx hardhat verify --network sepolia ${address}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
