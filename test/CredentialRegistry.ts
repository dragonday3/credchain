import { expect } from "chai";
import { network } from "hardhat";
import { anyUint } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

const { ethers, networkHelpers } = await network.create();

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = "0x" + "00".repeat(32);

/** Deterministic bytes32 test fixture value derived from a readable label. */
function bytes32Of(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function deployRegistryFixture() {
  const [admin, issuer, otherIssuer, holder, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("CredentialRegistry");
  return { registry, admin, issuer, otherIssuer, holder, stranger };
}

async function deployWithAuthorisedIssuerFixture() {
  const base = await deployRegistryFixture();
  await base.registry.addIssuer(base.issuer.address);
  return base;
}

async function deployWithCredentialFixture() {
  const base = await deployWithAuthorisedIssuerFixture();
  const credentialId = bytes32Of("credential-1");
  const credentialHash = bytes32Of("document-1");
  const holderHash = bytes32Of("holder-1");

  await base.registry.connect(base.issuer).registerCredential(credentialId, credentialHash, holderHash);

  return { ...base, credentialId, credentialHash, holderHash };
}

describe("CredentialRegistry", function () {
  describe("Deployment", function () {
    it("deploys successfully and has contract code at its address", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistryFixture);
      const code = await ethers.provider.getCode(await registry.getAddress());
      expect(code).to.not.equal("0x");
    });

    it("sets the deployer as the contract administrator (owner)", async function () {
      const { registry, admin } = await networkHelpers.loadFixture(deployRegistryFixture);
      expect(await registry.owner()).to.equal(admin.address);
    });

    it("starts with no authorised issuers", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployRegistryFixture);
      expect(await registry.isIssuer(issuer.address)).to.equal(false);
    });

    it("starts unpaused", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistryFixture);
      expect(await registry.paused()).to.equal(false);
    });
  });

  describe("Issuer management", function () {
    it("allows the admin to add an issuer", async function () {
      const { registry, admin, issuer } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(registry.addIssuer(issuer.address))
        .to.emit(registry, "IssuerAuthorized")
        .withArgs(issuer.address, admin.address);

      expect(await registry.isIssuer(issuer.address)).to.equal(true);
    });

    it("rejects a non-admin trying to add an issuer", async function () {
      const { registry, issuer, stranger } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(registry.connect(stranger).addIssuer(issuer.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("rejects the zero address as an issuer", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(registry.addIssuer(ZERO_ADDRESS)).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("rejects authorising an address that is already an issuer", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(registry.addIssuer(issuer.address))
        .to.be.revertedWithCustomError(registry, "IssuerAlreadyAuthorized")
        .withArgs(issuer.address);
    });

    it("allows the admin to remove an issuer", async function () {
      const { registry, admin, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(registry.removeIssuer(issuer.address))
        .to.emit(registry, "IssuerRemoved")
        .withArgs(issuer.address, admin.address);

      expect(await registry.isIssuer(issuer.address)).to.equal(false);
    });

    it("rejects a non-admin trying to remove an issuer", async function () {
      const { registry, issuer, stranger } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(registry.connect(stranger).removeIssuer(issuer.address))
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });

    it("rejects removing an address that is not currently an issuer", async function () {
      const { registry, stranger } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(registry.removeIssuer(stranger.address))
        .to.be.revertedWithCustomError(registry, "IssuerNotAuthorized")
        .withArgs(stranger.address);
    });
  });

  describe("Credential issuance", function () {
    it("allows an authorised issuer to register a credential and emits CredentialIssued", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);
      const credentialId = bytes32Of("credential-1");
      const credentialHash = bytes32Of("document-1");
      const holderHash = bytes32Of("holder-1");

      await expect(registry.connect(issuer).registerCredential(credentialId, credentialHash, holderHash))
        .to.emit(registry, "CredentialIssued")
        .withArgs(credentialId, issuer.address, holderHash, credentialHash, anyUint);
    });

    it("stores the credential data correctly", async function () {
      const { registry, issuer, credentialId, credentialHash, holderHash } =
        await networkHelpers.loadFixture(deployWithCredentialFixture);

      const record = await registry.getCredential(credentialId);

      expect(record.credentialHash).to.equal(credentialHash);
      expect(record.issuer).to.equal(issuer.address);
      expect(record.holderHash).to.equal(holderHash);
      expect(record.issuedAt).to.be.greaterThan(0n);
      expect(record.updatedAt).to.equal(record.issuedAt);
      expect(record.status).to.equal(0n); // CredentialStatus.Active
    });

    it("rejects an unauthorised caller trying to register a credential", async function () {
      const { registry, stranger } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(
        registry.connect(stranger).registerCredential(bytes32Of("credential-1"), bytes32Of("document-1"), bytes32Of("holder-1")),
      )
        .to.be.revertedWithCustomError(registry, "IssuerNotAuthorized")
        .withArgs(stranger.address);
    });

    it("rejects a zero credential ID", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(
        registry.connect(issuer).registerCredential(ZERO_BYTES32, bytes32Of("document-1"), bytes32Of("holder-1")),
      ).to.be.revertedWithCustomError(registry, "InvalidCredentialId");
    });

    it("rejects a zero credential hash", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(
        registry.connect(issuer).registerCredential(bytes32Of("credential-1"), ZERO_BYTES32, bytes32Of("holder-1")),
      ).to.be.revertedWithCustomError(registry, "InvalidCredentialHash");
    });

    it("rejects a zero holder reference hash", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);

      await expect(
        registry.connect(issuer).registerCredential(bytes32Of("credential-1"), bytes32Of("document-1"), ZERO_BYTES32),
      ).to.be.revertedWithCustomError(registry, "InvalidHolderReference");
    });

    it("rejects a duplicate credential ID", async function () {
      const { registry, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);

      await expect(
        registry.connect(issuer).registerCredential(credentialId, bytes32Of("document-2"), bytes32Of("holder-2")),
      )
        .to.be.revertedWithCustomError(registry, "CredentialAlreadyExists")
        .withArgs(credentialId);
    });

    it("rejects issuance while the contract is paused", async function () {
      const { registry, admin, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);
      await registry.connect(admin).pause();

      await expect(
        registry
          .connect(issuer)
          .registerCredential(bytes32Of("credential-1"), bytes32Of("document-1"), bytes32Of("holder-1")),
      ).to.be.revertedWithCustomError(registry, "EnforcedPause");
    });
  });

  describe("Verification and retrieval", function () {
    it("verifyCredential returns true for a valid, active credential", async function () {
      const { registry, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      expect(await registry.verifyCredential(credentialId)).to.equal(true);
    });

    it("verifyCredential returns false for a nonexistent credential (no revert)", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistryFixture);
      expect(await registry.verifyCredential(bytes32Of("does-not-exist"))).to.equal(false);
    });

    it("credentialExists reflects registration status", async function () {
      const { registry, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      expect(await registry.credentialExists(credentialId)).to.equal(true);
      expect(await registry.credentialExists(bytes32Of("does-not-exist"))).to.equal(false);
    });

    it("getCredential reverts with CredentialNotFound for a nonexistent credential", async function () {
      const { registry } = await networkHelpers.loadFixture(deployRegistryFixture);
      const missingId = bytes32Of("does-not-exist");

      await expect(registry.getCredential(missingId))
        .to.be.revertedWithCustomError(registry, "CredentialNotFound")
        .withArgs(missingId);
    });

    it("returns the correct credential data from getCredential", async function () {
      const { registry, issuer, credentialId, credentialHash, holderHash } =
        await networkHelpers.loadFixture(deployWithCredentialFixture);

      const [returnedHash, returnedIssuer, returnedHolderHash, issuedAt, updatedAt, status] =
        await registry.getCredential(credentialId);

      expect(returnedHash).to.equal(credentialHash);
      expect(returnedIssuer).to.equal(issuer.address);
      expect(returnedHolderHash).to.equal(holderHash);
      expect(issuedAt).to.equal(updatedAt);
      expect(status).to.equal(0n);
    });
  });

  describe("Credential hash updates", function () {
    it("allows the original issuer to update the credential hash while active", async function () {
      const { registry, issuer, credentialId, credentialHash } =
        await networkHelpers.loadFixture(deployWithCredentialFixture);
      const newHash = bytes32Of("document-1-corrected");

      await expect(registry.connect(issuer).updateCredentialHash(credentialId, newHash))
        .to.emit(registry, "CredentialHashUpdated")
        .withArgs(credentialId, issuer.address, credentialHash, newHash);

      const record = await registry.getCredential(credentialId);
      expect(record.credentialHash).to.equal(newHash);
    });

    it("rejects a hash update from an address that is not the original issuer", async function () {
      const { registry, admin, otherIssuer, credentialId } =
        await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(admin).addIssuer(otherIssuer.address);

      await expect(
        registry.connect(otherIssuer).updateCredentialHash(credentialId, bytes32Of("document-1-corrected")),
      )
        .to.be.revertedWithCustomError(registry, "Unauthorized")
        .withArgs(otherIssuer.address);
    });

    it("rejects a zero hash on update", async function () {
      const { registry, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);

      await expect(
        registry.connect(issuer).updateCredentialHash(credentialId, ZERO_BYTES32),
      ).to.be.revertedWithCustomError(registry, "InvalidCredentialHash");
    });

    it("rejects updating a credential that does not exist", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);
      const missingId = bytes32Of("does-not-exist");

      await expect(registry.connect(issuer).updateCredentialHash(missingId, bytes32Of("document-1")))
        .to.be.revertedWithCustomError(registry, "CredentialNotFound")
        .withArgs(missingId);
    });

    it("rejects updating the hash of an already-revoked credential", async function () {
      const { registry, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(issuer).revokeCredential(credentialId);

      await expect(
        registry.connect(issuer).updateCredentialHash(credentialId, bytes32Of("document-1-corrected")),
      ).to.be.revertedWithCustomError(registry, "InvalidCredentialState");
    });
  });

  describe("Revocation", function () {
    it("allows the original issuer to revoke a credential and emits CredentialRevoked", async function () {
      const { registry, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);

      await expect(registry.connect(issuer).revokeCredential(credentialId))
        .to.emit(registry, "CredentialRevoked")
        .withArgs(credentialId, issuer.address, anyUint);

      expect(await registry.verifyCredential(credentialId)).to.equal(false);
      const record = await registry.getCredential(credentialId);
      expect(record.status).to.equal(1n); // CredentialStatus.Revoked
    });

    it("allows the admin to revoke a credential as a safety valve", async function () {
      const { registry, admin, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);

      await expect(registry.connect(admin).revokeCredential(credentialId))
        .to.emit(registry, "CredentialRevoked")
        .withArgs(credentialId, admin.address, anyUint);
    });

    it("rejects revocation from an unrelated, unauthorised caller", async function () {
      const { registry, stranger, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);

      await expect(registry.connect(stranger).revokeCredential(credentialId))
        .to.be.revertedWithCustomError(registry, "Unauthorized")
        .withArgs(stranger.address);
    });

    it("rejects revocation from a different authorised issuer who did not issue it", async function () {
      const { registry, admin, otherIssuer, credentialId } =
        await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(admin).addIssuer(otherIssuer.address);

      await expect(registry.connect(otherIssuer).revokeCredential(credentialId))
        .to.be.revertedWithCustomError(registry, "Unauthorized")
        .withArgs(otherIssuer.address);
    });

    it("rejects revoking a nonexistent credential", async function () {
      const { registry, issuer } = await networkHelpers.loadFixture(deployWithAuthorisedIssuerFixture);
      const missingId = bytes32Of("does-not-exist");

      await expect(registry.connect(issuer).revokeCredential(missingId))
        .to.be.revertedWithCustomError(registry, "CredentialNotFound")
        .withArgs(missingId);
    });

    it("rejects revoking an already-revoked credential", async function () {
      const { registry, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(issuer).revokeCredential(credentialId);

      await expect(registry.connect(issuer).revokeCredential(credentialId))
        .to.be.revertedWithCustomError(registry, "CredentialAlreadyRevoked")
        .withArgs(credentialId);
    });

    it("rejects revocation while the contract is paused", async function () {
      const { registry, admin, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(admin).pause();

      await expect(registry.connect(issuer).revokeCredential(credentialId)).to.be.revertedWithCustomError(
        registry,
        "EnforcedPause",
      );
    });

    it("still allows verification of a revoked credential's existence and status while paused", async function () {
      const { registry, admin, issuer, credentialId } = await networkHelpers.loadFixture(deployWithCredentialFixture);
      await registry.connect(issuer).revokeCredential(credentialId);
      await registry.connect(admin).pause();

      expect(await registry.credentialExists(credentialId)).to.equal(true);
      expect(await registry.verifyCredential(credentialId)).to.equal(false);
      const record = await registry.getCredential(credentialId); // does not revert while paused
      expect(record.status).to.equal(1n); // CredentialStatus.Revoked
    });
  });

  describe("Emergency pause", function () {
    it("allows the admin to pause and unpause", async function () {
      const { registry, admin } = await networkHelpers.loadFixture(deployRegistryFixture);

      await registry.connect(admin).pause();
      expect(await registry.paused()).to.equal(true);

      await registry.connect(admin).unpause();
      expect(await registry.paused()).to.equal(false);
    });

    it("rejects a non-admin trying to pause", async function () {
      const { registry, stranger } = await networkHelpers.loadFixture(deployRegistryFixture);

      await expect(registry.connect(stranger).pause())
        .to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount")
        .withArgs(stranger.address);
    });
  });
});
