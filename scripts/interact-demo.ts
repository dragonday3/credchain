import { network } from "hardhat";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Post-deployment demo walkthrough for CredentialRegistry on Sepolia.
 *
 * Exercises the full permission-respecting lifecycle against the real deployed contract:
 * read admin info -> authorise an issuer -> register a credential -> verify it -> revoke it
 * -> verify it is now revoked. All identifiers/hashes below are deterministic, clearly
 * synthetic demo values (no real personal information, no real certificates).
 *
 *   npx hardhat run scripts/interact-demo.ts --network sepolia
 *
 * Reads the deployed address from Ignition's deployment record for chain 11155111 (Sepolia)
 * unless CONTRACT_ADDRESS is set in the environment.
 */

const DEPLOYMENTS_FILE = path.join(
  process.cwd(),
  "ignition",
  "deployments",
  "chain-11155111",
  "deployed_addresses.json",
);

function resolveContractAddress(): string {
  if (process.env.CONTRACT_ADDRESS !== undefined) {
    return process.env.CONTRACT_ADDRESS;
  }
  const deployed = JSON.parse(readFileSync(DEPLOYMENTS_FILE, "utf8"));
  return deployed["CredentialRegistryModule#CredentialRegistry"];
}

async function main(): Promise<void> {
  const { ethers } = await network.create();
  const [signer] = await ethers.getSigners();
  const address = resolveContractAddress();
  const registry = await ethers.getContractAt("CredentialRegistry", address, signer);

  console.log(`Contract: ${address}`);
  console.log(`Signer:   ${signer.address}`);

  // 1. Read administrator information.
  const owner = await registry.owner();
  console.log(`\n[1] Contract administrator (owner): ${owner}`);

  // Deterministic, clearly synthetic demo values -- no real personal data.
  const credentialId = ethers.keccak256(ethers.toUtf8Bytes("CRED-DEMO-001"));
  const credentialHash = ethers.keccak256(ethers.toUtf8Bytes("DEMO-CERTIFICATE-DOCUMENT-PLACEHOLDER"));
  const holderHash = ethers.keccak256(ethers.toUtf8Bytes("DEMO-HOLDER-REFERENCE-PLACEHOLDER"));
  console.log(`\nDemo credentialId:   ${credentialId}`);
  console.log(`Demo credentialHash: ${credentialHash}`);
  console.log(`Demo holderHash:     ${holderHash}`);

  // 2. Authorise an issuer (using the signer's own address as the demo issuer, since this
  //    script only has one funded Sepolia account available).
  if (!(await registry.isIssuer(signer.address))) {
    const tx = await registry.addIssuer(signer.address);
    const receipt = await tx.wait();
    console.log(`\n[2] addIssuer(${signer.address}) tx: ${tx.hash} (block ${receipt?.blockNumber})`);
  } else {
    console.log(`\n[2] ${signer.address} is already an authorised issuer, skipping addIssuer`);
  }

  // 3. Register a credential using the now-authorised issuer.
  if (!(await registry.credentialExists(credentialId))) {
    const tx = await registry.registerCredential(credentialId, credentialHash, holderHash);
    const receipt = await tx.wait();
    console.log(`\n[3] registerCredential(...) tx: ${tx.hash} (block ${receipt?.blockNumber})`);
  } else {
    console.log(`\n[3] Credential ${credentialId} already registered, skipping registerCredential`);
  }

  // 4. Read/verify the credential.
  const isValidBeforeRevoke = await registry.verifyCredential(credentialId);
  const record = await registry.getCredential(credentialId);
  console.log(`\n[4] verifyCredential -> ${isValidBeforeRevoke}`);
  console.log(`    getCredential -> issuer=${record.issuer}, status=${record.status} (0 = Active, 1 = Revoked)`);

  // 5. Revoke the credential.
  let revokeTxHash = "(already revoked, no new transaction)";
  if (record.status === 0n) {
    const tx = await registry.revokeCredential(credentialId);
    const receipt = await tx.wait();
    revokeTxHash = tx.hash;
    console.log(`\n[5] revokeCredential(...) tx: ${tx.hash} (block ${receipt?.blockNumber})`);
  } else {
    console.log(`\n[5] Credential already revoked, skipping revokeCredential`);
  }

  // 6. Verify the credential is now revoked.
  const isValidAfterRevoke = await registry.verifyCredential(credentialId);
  const recordAfter = await registry.getCredential(credentialId);
  console.log(`\n[6] verifyCredential (post-revocation) -> ${isValidAfterRevoke}`);
  console.log(`    getCredential (post-revocation) -> status=${recordAfter.status} (should be 1 = Revoked)`);

  console.log("\n=== Summary ===");
  console.log(`Contract address:   ${address}`);
  console.log(`credentialId:       ${credentialId}`);
  console.log(`Revoke tx hash:     ${revokeTxHash}`);
}

main().catch((error) => {
  console.error("Demo interaction failed:", error?.shortMessage ?? error?.message ?? error);
  process.exitCode = 1;
});
