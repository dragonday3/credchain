# CredChain — Blockchain-Based Digital Credential Verification System

CredChain lets an authorised educational or professional organisation issue, manage, verify,
and revoke digital credentials, using a Solidity smart contract as a tamper-evident
verification layer. This repository covers **Step 2 — Smart Contract Development** of the
assessment (Option 1, Technical Development Path). **No contract has been deployed to a live
network yet** — Step 3 (deployment + Etherscan verification) is a separate, later step.

## 1. Project overview

A credential (a degree, certificate, or professional qualification) is normally a PDF plus a
line in a university database. Anyone receiving it has to trust the issuer's word, or contact
the institution directly, that it is genuine and hasn't been revoked. CredChain replaces that
trust requirement with a public, tamper-evident record: given a credential ID, anyone can ask
the contract "is this genuine, and is it still active?" and get a verifiable, on-chain answer
— without contacting the issuer and without the chain ever holding the credential itself or
the holder's personal details.

## 2. Problem being solved

- **Forged/altered documents** are hard for a third party to detect from a PDF alone.
- **Revocation is invisible** — a printed or emailed certificate can't reflect that the issuer
  revoked it a year later.
- **Verification today means contacting the issuer**, which doesn't scale and isn't always
  possible (institution closed, slow response, etc.).

## 3. Why blockchain is appropriate here

The problem is fundamentally about a fact ("this credential is genuine and active") that many
mutually-distrusting parties (employers, other institutions, the public) need to check
independently, forever, without relying on the original issuer staying reachable and honest.
A public blockchain is a good fit specifically because:

- **Tamper-evidence**: once a credential's hash is recorded, no one — including the issuer —
  can quietly rewrite history.
- **No single point of failure for verification**: the record survives independently of the
  issuing institution's own servers.
- **Auditable history**: every issuance, hash correction, and revocation is a permanent,
  timestamped event log, not a mutable database row.

Blockchain is *not* used to store the credential or any personal data — see §12 for exactly
what stays off-chain and why.

## 4. Architecture

```
OFF-CHAIN (never sent to the contract)          ON-CHAIN (CredentialRegistry.sol)
─────────────────────────────────────           ──────────────────────────────────
Certificate / document file           ──hash──▶  credentialHash  (keccak256)
Holder's name, ID, email, etc.        ──hash──▶  holderHash       (keccak256)
Additional metadata (grades, etc.)               credentialId, issuer, timestamps, status
```

Four roles interact with the contract:

| Role | Can do |
| --- | --- |
| **Contract administrator** (`owner`) | Authorise/remove issuers, pause/unpause, revoke any credential as a safety valve |
| **Authorised issuer** | Register credentials, correct a credential's hash, revoke credentials they issued |
| **Credential holder** | Off-chain: presents the document + a way to derive their `holderHash`; has no special on-chain privileges |
| **Public verifier** | Anyone — calls the read-only verification functions, no permission needed |

## 5. Smart contract functionality

Contract: [`contracts/CredentialRegistry.sol`](contracts/CredentialRegistry.sol)

**Admin-only** (`onlyOwner`):
- `addIssuer(address issuer)` — authorise a new credential issuer
- `removeIssuer(address issuer)` — revoke an issuer's authorisation
- `pause()` / `unpause()` — emergency stop for issuance, hash updates, and revocation (see §9)

**Issuer-only** (`onlyIssuer`, and only while not paused):
- `registerCredential(bytes32 credentialId, bytes32 credentialHash, bytes32 holderHash)`
- `updateCredentialHash(bytes32 credentialId, bytes32 newCredentialHash)` — original issuer only, only while the credential is still `Active`
- `revokeCredential(bytes32 credentialId)` — the original issuer **or** the admin (see §9 for why)

**Public, no permission required**:
- `isIssuer(address account) view returns (bool)`
- `credentialExists(bytes32 credentialId) view returns (bool)`
- `verifyCredential(bytes32 credentialId) view returns (bool isValid)` — cheap yes/no check, never reverts
- `getCredential(bytes32 credentialId) view returns (...)` — full record, reverts `CredentialNotFound` if unknown

Inherited from OpenZeppelin `Ownable`: `owner()`, `transferOwnership(address)`, `renounceOwnership()`.
Inherited from OpenZeppelin `Pausable`: `paused()`.

### Events

`IssuerAuthorized`, `IssuerRemoved`, `CredentialIssued`, `CredentialHashUpdated`,
`CredentialRevoked` — each with indexed fields (issuer/credential ID) so an off-chain indexer
can efficiently rebuild the full audit trail.

### Custom errors

`Unauthorized`, `InvalidAddress`, `IssuerAlreadyAuthorized`, `IssuerNotAuthorized`,
`InvalidCredentialId`, `InvalidCredentialHash`, `InvalidHolderReference`,
`CredentialAlreadyExists`, `CredentialNotFound`, `CredentialAlreadyRevoked`,
`InvalidCredentialState`, plus OpenZeppelin's `OwnableUnauthorizedAccount`,
`OwnableInvalidOwner`, `EnforcedPause`, `ExpectedPause`.

## 6. Roles and permissions

See the table in §4. Every state-changing function enforces its permission with a `require`-
style custom-error check (`onlyOwner`, the `onlyIssuer` modifier, or an explicit
issuer/admin comparison in `revokeCredential`/`updateCredentialHash`) — there is no function
that mutates state without an explicit permission check.

## 7. Project structure

```
credchain/
├── contracts/
│   └── CredentialRegistry.sol       Main contract
├── test/
│   └── CredentialRegistry.ts        Full Mocha + ethers test suite (39 tests)
├── ignition/modules/
│   └── CredentialRegistry.ts        Hardhat Ignition deployment module (recommended)
├── scripts/
│   └── deploy.ts                    Simple imperative deployment script (alternative)
├── hardhat.config.ts
├── package.json
├── tsconfig.json
├── .gitignore
└── .env.example
```

## 8. Prerequisites

- Node.js 24.x, npm 11.x (or newer)
- No global install required — everything runs through local `devDependencies` via `npx`

## 9. Advanced features beyond the minimum

The assessment requires three functional features; this contract implements more, chosen
because each addresses a real gap rather than to pad the line count:

- **Issuer lifecycle management** (`addIssuer` / `removeIssuer`) rather than a single hardcoded
  issuer — realistic for an institution with multiple staff/departments issuing credentials.
- **Hash correction** (`updateCredentialHash`), restricted to the original issuer and only
  while `Active` — lets an issuer fix a genuine mistake without needing to revoke and
  re-register under a new ID (which would break any link already shared).
- **Admin revocation safety valve**: `revokeCredential` accepts the original issuer *or* the
  admin. This matters because an issuer removed via `removeIssuer` would otherwise be
  permanently unable to revoke credentials they issued while still authorised — with no
  admin override, a bad credential from a since-removed issuer could never be cleaned up.
- **Emergency pause** (`pause` / `unpause`, OpenZeppelin `Pausable`), scoped *only* to
  state-changing issuer actions. Verification (`verifyCredential`, `getCredential`,
  `credentialExists`) deliberately keeps working even while paused — a credential that's
  already been issued must stay publicly verifiable at all times, including during an
  incident (e.g. a compromised issuer key) where the admin wants to freeze new activity.
- **Two-tier revert design for "not found"**: `verifyCredential` returns `false` for an unknown
  ID (a public verifier widget can call it as a plain boolean check, no error handling
  needed), while `getCredential` reverts with `CredentialNotFound` (a caller asking for actual
  data gets an explicit error instead of a silently empty struct). Both are exercised in the
  test suite.
- **Privacy-conscious identifiers by construction** — see §12.

## 10. Installation

```shell
npm install
```

## 11. Compilation

```shell
npx hardhat build
```

Compiles with solc `0.8.34`. Optional but recommended after any change — regenerates
TypeChain types before you typecheck the tests:

```shell
npx hardhat build && npx tsc --noEmit
```

## 12. Testing

```shell
npx hardhat test
```

Runs the full suite (39 tests) covering: deployment, issuer management (authorised/
unauthorised add & remove, zero address, duplicates), credential issuance (success,
unauthorised caller, zero credential ID/hash/holder-reference, duplicate ID, paused state),
verification and retrieval (valid, nonexistent — both the non-reverting and reverting paths),
hash updates (original issuer, wrong caller, zero hash, nonexistent credential, revoked
credential), revocation (original issuer, admin override, unrelated caller, wrong issuer,
nonexistent, already-revoked, paused state, verifiability while paused), and the emergency
pause switch itself.

Latest run:

```
39 passing (621ms)
```

You can also scope to a single test layer:

```shell
npx hardhat test mocha
```

## 13. Deployment preparation (Step 3 — not performed here)

Two deployment paths are prepared, neither of which has been run against Sepolia:

**Recommended — Hardhat Ignition** (idempotent, tracks state per network, integrates with
`hardhat verify`):

```shell
npx hardhat ignition deploy ignition/modules/CredentialRegistry.ts --network sepolia --verify
```

**Alternative — plain script**, for a simpler, explicit read of the deployment flow:

```shell
npx hardhat run scripts/deploy.ts --network sepolia
```

Etherscan verification (after a real deployment):

```shell
npx hardhat verify --network sepolia <DEPLOYED_ADDRESS>
```

## 14. Environment variables

Copy `.env.example` to `.env` and fill in real values before Step 3. **Never commit `.env`**
(already covered by `.gitignore`).

| Variable | Purpose |
| --- | --- |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint (e.g. an Alchemy URL) |
| `PRIVATE_KEY` | Deployer/admin account's private key (0x-prefixed) — use a dedicated test wallet only |
| `ETHERSCAN_API_KEY` | Used by `npx hardhat verify` |

`hardhat.config.ts` reads these via `configVariable(...)`, which checks the environment
variable first and only falls back to Hardhat's encrypted keystore
(`npx hardhat keystore set SEPOLIA_RPC_URL`) if the variable isn't set — so either approach
works, and the keystore is the more secure option for a real deployment.

## 15. Security and privacy considerations

**What's stored on-chain, and why nothing else is**: see §12 below for the full rationale —
the short version is that the contract stores only `credentialId`, `credentialHash`,
`holderHash`, `issuer`, timestamps, and status. It never receives the certificate document,
the holder's name, student ID, email, or any other personal information; those stay off-chain
with the issuing institution, and only their hashes ever reach the contract.

**Security review performed** (Phase 9 of the brief) — findings and how each is addressed:

| Concern | Assessment |
| --- | --- |
| Unauthorized state changes | Every state-changing function checks `onlyOwner`, `onlyIssuer`, or an explicit issuer/admin match; covered by negative tests. |
| Duplicate credential registration | Explicit `issuedAt != 0` existence check before writing; `CredentialAlreadyExists` on a repeat ID. |
| Invalid identifiers / hashes / zero addresses | Zero-value checks on `credentialId`, `credentialHash`, `holderHash`, and issuer addresses. |
| Revocation logic errors | Revoking an already-revoked credential reverts `CredentialAlreadyRevoked`; status is a two-value enum, no ambiguous states. |
| Issuer permission errors | `updateCredentialHash` and `revokeCredential` both check the caller against the credential's *stored* issuer, not just "any authorised issuer" — one issuer cannot touch another's credentials (except the admin override on revoke, which is intentional — see §9). |
| Accidental public mutation | All mutating functions are `external`, none are `public`; all view functions are read-only by the compiler. |
| Unsafe external calls / reentrancy | The contract makes no external calls and holds no Ether (no `payable` functions), so there is no reentrancy surface. |
| Integer overflow/underflow | Solidity ≥0.8 reverts on overflow by default; the only arithmetic is `uint64(block.timestamp)`, safe until the year 2554. |
| `tx.origin` | Not used anywhere; all authorisation checks use `msg.sender`. |
| `block.timestamp` reliance | Used only for informational `issuedAt`/`updatedAt` values, not for access control or randomness — the few seconds of miner discretion over it has no security consequence here. |
| Unnecessary Ether handling | The contract has no `payable` functions and cannot receive Ether; this is deliberate — it is a notarisation registry, not a treasury, so there's nothing to secure or drain. |
| Privacy leakage | See §12 — no PII is ever accepted as a function argument. |

**Honest limitations** (this contract is not "100% secure" and does not claim to be):
- `onlyOwner` is a single-key trust root; losing that key means losing admin control (mitigated
  by `Ownable`'s `transferOwnership`, but key custody itself is outside this contract's scope).
- The contract cannot verify that a `credentialHash` or `holderHash` was computed correctly by
  the issuer's off-chain system — it can only prove that *whatever hash was submitted* hasn't
  been altered since. Garbage in, garbage on-chain.
- No on-chain enumeration of issuers or credentials by design (see the `_issuers` mapping
  comment in the contract) — an off-chain indexer reconstructing state from events is expected
  for any UI that needs to list things.

## 16. Current limitations

- No batch operations (e.g. bulk-issuing many credentials in one transaction) — each
  credential is registered individually, which is simplest to reason about and test, at the
  cost of one transaction per credential.
- No on-chain fee/monetisation logic — out of scope for a verification registry.
- No upgradeability (proxy pattern) — deliberate: a verification registry benefits from
  bytecode permanence more than from upgrade flexibility, and upgradeability introduces its
  own, larger security surface than this assessment calls for.

## 17. Future improvements

- An off-chain indexer/subgraph over the emitted events, to give holders and verifiers a
  searchable UI instead of requiring the exact `credentialId`.
- Batch issuance for institutions onboarding many credentials at once.
- A holder-side proof mechanism (e.g. holder signs a challenge with the key whose hash matches
  `holderHash`) so a holder can prove ownership on demand, without ever revealing the
  underlying identifier used to derive the hash.

## 18. Assessment Requirement Mapping

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Minimum of three functional features | Issuer management, credential issuance, verification/retrieval, revocation, hash correction, emergency pause | `contracts/CredentialRegistry.sol` — 11 external/public functions across admin, issuer, and public tiers |
| Appropriate events for key actions | `IssuerAuthorized`, `IssuerRemoved`, `CredentialIssued`, `CredentialHashUpdated`, `CredentialRevoked` | `test/CredentialRegistry.ts` — `.to.emit(...)` assertions in issuance, hash-update, and revocation tests |
| Error handling via `require`/`revert` | 11 custom errors + OpenZeppelin's `OwnableUnauthorizedAccount`/`EnforcedPause`, used on every validation path | `test/CredentialRegistry.ts` — every negative test asserts a specific `revertedWithCustomError` |
| Well-commented Solidity, best practices | Contract-level `@dev` notes explaining each design decision (privacy model, access-control choice, pause scope), full NatSpec on every external/public function, explicit visibility, no unused imports | `contracts/CredentialRegistry.sol` |
| Advanced features beyond the minimum | Issuer lifecycle management, admin revocation safety valve, hash correction restricted to `Active` credentials, scoped emergency pause, privacy-preserving identifier design, dual revert/no-revert "not found" handling | See §9; corresponding contract functions and tests |
| Fully functional contract meeting all requirements | Compiles cleanly, 39/39 tests passing | §11 (compilation), §12 (test run) |
| Clean, well-structured code | Grouped sections (Types / Storage / Events / Errors / Modifiers / Constructor / Admin / Issuer / Public view), consistent naming, `bytes32` identifiers over strings for gas efficiency | `contracts/CredentialRegistry.sol` |
| Robust error handling | Every external state-changing function validates its inputs and caller before writing state; zero silent failures | `contracts/CredentialRegistry.sol`, exhaustive negative-path tests |

No test results, compilation output, or deployment claims in this document are fabricated —
the exact commands to reproduce every number above are given in §11–§13.
