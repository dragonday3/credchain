// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Pausable } from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title CredentialRegistry
/// @author CredChain
/// @notice On-chain verification layer for digital credentials (academic / professional
///         certificates). The contract never stores the credential document, the holder's
///         personal information, or any other sensitive data — only what is strictly needed
///         to prove, on-chain, that a specific off-chain credential is genuine and still valid.
///
/// @dev Design decision — privacy by construction:
///      Off-chain (kept by the issuing institution / holder, never sent to this contract):
///        - the certificate/document itself (PDF, image, etc.)
///        - the holder's name, student ID, email, or any other personal information
///        - any additional metadata (grades, course details, etc.)
///      On-chain (stored in this contract):
///        - `credentialId`   — an opaque identifier chosen by the issuer (e.g. keccak256 of an
///                             internal reference number). Never a name or email.
///        - `credentialHash` — keccak256 hash of the off-chain document, so anyone holding the
///                             original file can prove it matches what was registered.
///        - `holderHash`     — keccak256 hash of a holder reference (e.g. student ID + salt),
///                             so the holder can prove ownership without the ID ever appearing
///                             on-chain in the clear.
///        - issuer address, issuance/update timestamps, and a status flag.
///      This makes the chain a tamper-evident notarisation layer, not a database of PII.
///
/// @dev Access control: OpenZeppelin's `Ownable` is used for the single contract administrator
///      because there is exactly one admin role with no need for multiple permission tiers —
///      it is the smallest, most battle-tested primitive that covers "one privileged account
///      that can be transferred/renounced safely" (zero-address checks, two-step-safe events,
///      no reinvented ownership logic). Authorised issuers are a separate, open-ended set of
///      addresses, modelled with a simple `mapping(address => bool)` rather than OZ
///      `AccessControl`: there is only one issuer "tier" (no sub-roles, no role admin
///      hierarchy), so a full role-based access control system would add bytes32 role
///      constants and role-admin bookkeeping that this contract has no use for.
///
/// @dev Emergency control: `Pausable` gates only the state-changing issuer actions (issuing,
///      revoking, updating a hash). Verification and retrieval (`verifyCredential`,
///      `getCredential`, `credentialExists`) are intentionally NEVER paused — a credential
///      that has already been issued must remain publicly verifiable at all times, even while
///      the admin has paused new activity (e.g. while investigating a compromised issuer key).
contract CredentialRegistry is Ownable, Pausable {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    /// @notice Lifecycle state of a credential.
    enum CredentialStatus {
        Active,
        Revoked
    }

    /// @notice Minimal on-chain record of a credential. See the contract-level @dev note for
    ///         why each field exists and why no personal data is stored here.
    struct Credential {
        bytes32 credentialHash; // keccak256 hash of the off-chain document
        address issuer; // address that issued this credential
        bytes32 holderHash; // privacy-preserving reference to the holder
        uint64 issuedAt; // unix timestamp of issuance (0 == "does not exist")
        uint64 updatedAt; // unix timestamp of the last status/hash change
        CredentialStatus status; // Active | Revoked
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @dev credentialId => credential record.
    mapping(bytes32 => Credential) private _credentials;

    /// @dev issuer address => authorisation flag. A mapping (rather than an enumerable set)
    ///      is enough because the contract never needs to list all issuers on-chain — a
    ///      verifier only ever needs to check a single address, and the full authorisation
    ///      history is already recoverable off-chain from `IssuerAuthorized`/`IssuerRemoved`.
    mapping(address => bool) private _issuers;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    /// @notice Emitted when the admin authorises a new credential issuer.
    event IssuerAuthorized(address indexed issuer, address indexed authorizedBy);

    /// @notice Emitted when the admin revokes an issuer's authorisation.
    event IssuerRemoved(address indexed issuer, address indexed removedBy);

    /// @notice Emitted when a new credential is registered on-chain.
    event CredentialIssued(
        bytes32 indexed credentialId,
        address indexed issuer,
        bytes32 holderHash,
        bytes32 credentialHash,
        uint64 issuedAt
    );

    /// @notice Emitted when a credential's document hash is corrected/updated.
    event CredentialHashUpdated(
        bytes32 indexed credentialId,
        address indexed issuer,
        bytes32 oldHash,
        bytes32 newHash
    );

    /// @notice Emitted when a credential is revoked.
    event CredentialRevoked(bytes32 indexed credentialId, address indexed revokedBy, uint64 revokedAt);

    // ---------------------------------------------------------------------
    // Custom errors
    // ---------------------------------------------------------------------

    /// @notice Thrown when the caller is not permitted to perform the requested action.
    error Unauthorized(address caller);

    /// @notice Thrown when a zero address is supplied where a real address is required.
    error InvalidAddress();

    /// @notice Thrown when trying to authorise an address that is already an issuer.
    error IssuerAlreadyAuthorized(address issuer);

    /// @notice Thrown when the caller (or target) is not an authorised issuer.
    error IssuerNotAuthorized(address issuer);

    /// @notice Thrown when a credential ID is the zero value.
    error InvalidCredentialId();

    /// @notice Thrown when a credential hash is the zero value.
    error InvalidCredentialHash();

    /// @notice Thrown when a holder reference hash is the zero value.
    error InvalidHolderReference();

    /// @notice Thrown when trying to register a credential ID that is already in use.
    error CredentialAlreadyExists(bytes32 credentialId);

    /// @notice Thrown when a credential ID has no matching record.
    error CredentialNotFound(bytes32 credentialId);

    /// @notice Thrown when trying to revoke a credential that is already revoked.
    error CredentialAlreadyRevoked(bytes32 credentialId);

    /// @notice Thrown when an action requires a credential to be in a state it is not in
    ///         (e.g. updating the hash of a credential that has already been revoked).
    error InvalidCredentialState();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    /// @dev Restricts a function to addresses currently authorised as issuers.
    modifier onlyIssuer() {
        if (!_issuers[msg.sender]) revert IssuerNotAuthorized(msg.sender);
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @notice Deploys the registry and sets the deployer as the contract administrator.
    constructor() Ownable(msg.sender) {}

    // ---------------------------------------------------------------------
    // Admin functions (owner only)
    // ---------------------------------------------------------------------

    /// @notice Authorises `issuer` to register and manage credentials.
    /// @param issuer Address to grant issuer status to.
    function addIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert InvalidAddress();
        if (_issuers[issuer]) revert IssuerAlreadyAuthorized(issuer);

        _issuers[issuer] = true;
        emit IssuerAuthorized(issuer, msg.sender);
    }

    /// @notice Revokes `issuer`'s authorisation. Credentials they already issued are
    ///         unaffected and remain verifiable; the admin can still revoke them if needed
    ///         (see {revokeCredential}).
    /// @param issuer Address to remove issuer status from.
    function removeIssuer(address issuer) external onlyOwner {
        if (!_issuers[issuer]) revert IssuerNotAuthorized(issuer);

        _issuers[issuer] = false;
        emit IssuerRemoved(issuer, msg.sender);
    }

    /// @notice Pauses credential issuance, hash updates and revocations. Verification and
    ///         retrieval of existing credentials keep working while paused.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes normal operation after {pause}.
    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Issuer functions
    // ---------------------------------------------------------------------

    /// @notice Registers a new credential on-chain.
    /// @dev Reverts if the caller is not an authorised issuer, if any identifier/hash is the
    ///      zero value, or if `credentialId` is already in use.
    /// @param credentialId Opaque, issuer-chosen unique identifier for the credential.
    /// @param credentialHash keccak256 hash of the off-chain credential document.
    /// @param holderHash Privacy-preserving reference hash identifying the holder.
    function registerCredential(
        bytes32 credentialId,
        bytes32 credentialHash,
        bytes32 holderHash
    ) external onlyIssuer whenNotPaused {
        if (credentialId == bytes32(0)) revert InvalidCredentialId();
        if (credentialHash == bytes32(0)) revert InvalidCredentialHash();
        if (holderHash == bytes32(0)) revert InvalidHolderReference();
        if (_credentials[credentialId].issuedAt != 0) revert CredentialAlreadyExists(credentialId);

        uint64 timestamp = uint64(block.timestamp);
        _credentials[credentialId] = Credential({
            credentialHash: credentialHash,
            issuer: msg.sender,
            holderHash: holderHash,
            issuedAt: timestamp,
            updatedAt: timestamp,
            status: CredentialStatus.Active
        });

        emit CredentialIssued(credentialId, msg.sender, holderHash, credentialHash, timestamp);
    }

    /// @notice Updates the document hash of an existing, still-active credential (e.g. to
    ///         correct a mistake in the originally registered hash).
    /// @dev Only the original issuer may update the hash, and only while the credential is
    ///      still Active — a revoked credential's history is immutable.
    /// @param credentialId Identifier of the credential to update.
    /// @param newCredentialHash New keccak256 hash of the off-chain document.
    function updateCredentialHash(bytes32 credentialId, bytes32 newCredentialHash) external onlyIssuer whenNotPaused {
        Credential storage cred = _credentials[credentialId];
        if (cred.issuedAt == 0) revert CredentialNotFound(credentialId);
        if (cred.issuer != msg.sender) revert Unauthorized(msg.sender);
        if (cred.status != CredentialStatus.Active) revert InvalidCredentialState();
        if (newCredentialHash == bytes32(0)) revert InvalidCredentialHash();

        bytes32 oldHash = cred.credentialHash;
        cred.credentialHash = newCredentialHash;
        cred.updatedAt = uint64(block.timestamp);

        emit CredentialHashUpdated(credentialId, msg.sender, oldHash, newCredentialHash);
    }

    /// @notice Revokes a credential, marking it permanently invalid.
    /// @dev Callable by the credential's original issuer, or by the contract owner as a
    ///      safety valve — this matters because an issuer that has since been removed via
    ///      {removeIssuer} would otherwise be unable to revoke credentials they issued while
    ///      still authorised, and no one else could clean up after them.
    /// @param credentialId Identifier of the credential to revoke.
    function revokeCredential(bytes32 credentialId) external whenNotPaused {
        Credential storage cred = _credentials[credentialId];
        if (cred.issuedAt == 0) revert CredentialNotFound(credentialId);
        if (msg.sender != cred.issuer && msg.sender != owner()) revert Unauthorized(msg.sender);
        if (cred.status == CredentialStatus.Revoked) revert CredentialAlreadyRevoked(credentialId);

        cred.status = CredentialStatus.Revoked;
        cred.updatedAt = uint64(block.timestamp);

        emit CredentialRevoked(credentialId, msg.sender, cred.updatedAt);
    }

    // ---------------------------------------------------------------------
    // Public view functions (anyone may call these — no permission required)
    // ---------------------------------------------------------------------

    /// @notice Checks whether `account` is currently an authorised issuer.
    /// @param account Address to check.
    /// @return authorised True if `account` may issue and manage credentials.
    function isIssuer(address account) external view returns (bool authorised) {
        return _issuers[account];
    }

    /// @notice Checks whether a credential ID has a matching on-chain record.
    /// @param credentialId Identifier to check.
    /// @return exists True if a credential was ever registered under this ID.
    function credentialExists(bytes32 credentialId) external view returns (bool exists) {
        return _credentials[credentialId].issuedAt != 0;
    }

    /// @notice Cheap public verification check: is this credential genuine and still active?
    /// @dev Deliberately returns `false` for an unknown ID instead of reverting, so any
    ///      verifier (e.g. an employer's website) can call it as a plain yes/no check without
    ///      needing to handle a revert.
    /// @param credentialId Identifier of the credential to verify.
    /// @return isValid True only if the credential exists and its status is Active.
    function verifyCredential(bytes32 credentialId) external view returns (bool isValid) {
        Credential storage cred = _credentials[credentialId];
        return cred.issuedAt != 0 && cred.status == CredentialStatus.Active;
    }

    /// @notice Retrieves the full on-chain record for a credential.
    /// @dev Reverts with {CredentialNotFound} for an unknown ID — unlike {verifyCredential},
    ///      a caller asking for the record's data expects either real data or an explicit
    ///      error, not a silently empty struct.
    /// @param credentialId Identifier of the credential to retrieve.
    /// @return credentialHash keccak256 hash of the off-chain document.
    /// @return issuer Address that issued the credential.
    /// @return holderHash Privacy-preserving reference hash identifying the holder.
    /// @return issuedAt Unix timestamp of issuance.
    /// @return updatedAt Unix timestamp of the last status/hash change.
    /// @return status Current lifecycle status of the credential.
    function getCredential(
        bytes32 credentialId
    )
        external
        view
        returns (
            bytes32 credentialHash,
            address issuer,
            bytes32 holderHash,
            uint64 issuedAt,
            uint64 updatedAt,
            CredentialStatus status
        )
    {
        Credential storage cred = _credentials[credentialId];
        if (cred.issuedAt == 0) revert CredentialNotFound(credentialId);

        return (cred.credentialHash, cred.issuer, cred.holderHash, cred.issuedAt, cred.updatedAt, cred.status);
    }
}
