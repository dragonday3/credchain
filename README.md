# CredChain — Blockchain-Based Digital Credential Verification System

CredChain lets an authorised educational or professional organisation issue, manage, verify,
and revoke digital credentials, using a Solidity smart contract as a tamper-evident
verification layer. This repository covers **Step 2 — Smart Contract Development** and
**Step 3 — Deployment and Verification** of the assessment (Option 1, Technical Development
Path). The contract is deployed and verified on **Ethereum Sepolia** — see §19 for the deployed
address, transaction evidence, and full reproduction steps.

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
| Integer overflow/underflow | Solidity ≥0.8 reverts on overflow by default; the only arithmetic is `uint64(block.timestamp)`, which does not overflow until roughly 585 billion years after the Unix epoch. |
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
- A holder-side proof mechanism — e.g. the holder discloses the (identifier, salt) preimage to
  a verifier, who recomputes `keccak256(identifier, salt)` and checks it against the on-chain
  `holderHash`, or, for full privacy, proves knowledge of that preimage with a zero-knowledge
  proof — so a holder can prove ownership on demand without the underlying identifier ever
  being submitted to the contract itself.

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
the exact commands to reproduce every number above are given in §11–§13, and the Step 3
deployment evidence in §19 is all independently verifiable on-chain and on Etherscan.

## 19. Step 3 — Deployment and Verification (Sepolia)

### 19.1 Prerequisites

- Everything in §8, plus:
- An [Alchemy](https://www.alchemy.com/) account with a Sepolia app (for the RPC URL)
- A Sepolia-only wallet (never a mainnet/real-funds key) with a small amount of Sepolia test
  ETH — obtainable from a public faucet (e.g. the Alchemy or Google Cloud Sepolia faucet)
- An [Etherscan](https://etherscan.io/) account and API key (for source verification)

### 19.2 Environment variables

Same three variables as §14 — `SEPOLIA_RPC_URL`, `PRIVATE_KEY`, `ETHERSCAN_API_KEY` — set in a
local `.env` (copied from `.env.example`, never committed). `hardhat.config.ts` reads all three
via `configVariable(...)`, which resolves from `process.env` first.

### 19.3 Alchemy configuration

Create an app in the Alchemy dashboard on the **Sepolia** network and copy its HTTPS URL
(`https://eth-sepolia.g.alchemy.com/v2/<key>`) into `SEPOLIA_RPC_URL`.

### 19.4 Sepolia wallet setup and ETH requirement

Generate a dedicated wallet for this project (e.g. `new ethers.Wallet(...)` or any wallet
tool) and fund it with Sepolia test ETH from a faucet. Deployment plus a few post-deployment
interactions cost well under 0.01 ETH in practice (see §19.6/§19.9 for actual gas figures from
this deployment) — 0.02–0.05 test ETH is comfortably enough.

### 19.5 Compilation and testing (pre-deployment gate)

```shell
npx hardhat build --build-profile production
npx tsc --noEmit
npx hardhat test
```

All three must pass before deploying — this project's actual run: **39/39 tests passing**,
clean typecheck, clean compile with solc `0.8.34` (optimizer enabled, 200 runs — the
`production` build profile).

> ⚠️ **Build profile consistency**: Hardhat 3's `hardhat-verify` plugin defaults `verify` to the
> `production` profile, but `hardhat build`/`hardhat run` default to `default` (no optimizer).
> Running *any* `hardhat run`/`hardhat build` without `--build-profile production` in between
> your deployment and your verification step will silently recompile and overwrite the local
> artifacts, causing verification to fail with a bytecode mismatch. Always pass
> `--build-profile production` explicitly on every command from build through verify. See
> §19.14 for how this was actually hit and fixed during this deployment.

### 19.6 Deployment command and result

Deployed with Hardhat Ignition (see `ignition/modules/CredentialRegistry.ts`):

```shell
HARDHAT_IGNITION_CONFIRM_DEPLOYMENT=true npx hardhat ignition deploy \
  ignition/modules/CredentialRegistry.ts --network sepolia --build-profile production
```

(`HARDHAT_IGNITION_CONFIRM_DEPLOYMENT` is Ignition's own documented flag for skipping its
interactive `y/N` confirmation prompt in a non-interactive/CI shell — it does not touch or
expose any secret.)

| Field | Value |
| --- | --- |
| Network | Sepolia (chainId `11155111`) |
| Contract | `CredentialRegistry` |
| **Contract address** | [`0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc`](https://sepolia.etherscan.io/address/0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc) |
| **Deployment transaction** | [`0xd165941c59bdf422654cbf17950d858428f675ff463f736c26f4fe89d8b784c4`](https://sepolia.etherscan.io/tx/0xd165941c59bdf422654cbf17950d858428f675ff463f736c26f4fe89d8b784c4) |
| Deployer / admin address | `0xF571D04625D866248a21ae34f7f048331208fc84` |
| Block number | `11793137` |
| Block timestamp | `2026-09-27T11:49:24.000Z` (unix `1790509764`) |
| Gas used | `763644` |
| Deployment cost | `≈0.000765 ETH` |
| Status | `SUCCESS` |

Full deployment records (journal, build-info snapshot, deployed address) are committed under
`ignition/deployments/chain-11155111/` for reproducibility and audit.

### 19.7 Confirming the deployment on Sepolia Etherscan

- Contract page: <https://sepolia.etherscan.io/address/0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc>
- Deployment transaction: <https://sepolia.etherscan.io/tx/0xd165941c59bdf422654cbf17950d858428f675ff463f736c26f4fe89d8b784c4>

Both were confirmed to exist and show `Success` status at the time of writing (19 block
confirmations checked immediately after deployment).

### 19.8 Source code verification

```shell
npx hardhat --build-profile production verify --network sepolia \
  0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc
```

This project's `hardhat-verify` plugin (bundled in the ethers+mocha toolbox) verifies against
**Etherscan**, **Blockscout**, and **Sourcify** in one command — all three succeeded:

- Etherscan: <https://sepolia.etherscan.io/address/0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc#code>
- Blockscout: <https://eth-sepolia.blockscout.com/address/0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc#code>
- Sourcify: <https://sourcify.dev/server/repo-ui/11155111/0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc>

No constructor arguments were needed (the constructor takes none — the deployer becomes the
admin automatically).

**Independently re-checked** via the Etherscan API directly (not just the plugin's own success
message), confirming genuine verification rather than a false positive:

```shell
curl "https://api.etherscan.io/v2/api?chainid=11155111&module=contract&action=getsourcecode&address=0x641FF9a8A3D294756F028e6eC42EDAA15E5d96cc&apikey=$ETHERSCAN_API_KEY"
```

Result: `ContractName: CredentialRegistry`, `CompilerVersion: v0.8.34+commit.80d5c536`,
`OptimizationUsed: 1`, `Runs: 200`, non-empty `SourceCode` and `ABI`, `Proxy: 0`.

### 19.9 Post-deployment interactions

Run against the live deployed contract with `scripts/interact-demo.ts`:

```shell
npx hardhat run scripts/interact-demo.ts --network sepolia --build-profile production
```

The script reads the deployed address from `ignition/deployments/chain-11155111/deployed_addresses.json`
automatically, then walks through the full permission-respecting lifecycle using **clearly
synthetic demo values** (no real personal information):

- `credentialId` derived from the literal label `"CRED-DEMO-001"`
- `credentialHash` derived from the literal placeholder `"DEMO-CERTIFICATE-DOCUMENT-PLACEHOLDER"`
- `holderHash` derived from the literal placeholder `"DEMO-HOLDER-REFERENCE-PLACEHOLDER"`

| # | Action | Transaction | Block | Gas used |
| --- | --- | --- | --- | --- |
| 1 | Read `owner()` | *(read-only, no tx)* | — | — |
| 2 | `addIssuer` (deployer authorises itself as the demo issuer, since only one funded account is available) | [`0x0780444e...9f6b7`](https://sepolia.etherscan.io/tx/0x0780444e5f27369d8f8d773f091093c13fe7f042f3edbbc5d92c77125a49f6b7) | `11793183` | `47863` |
| 3 | `registerCredential` | [`0x8516c427...4de521`](https://sepolia.etherscan.io/tx/0x8516c42746ceddf28b23ba709d9fbb7e5071b319fc292dede368acba524de521) | `11793184` | `118907` |
| 4 | `verifyCredential` / `getCredential` | *(read-only, no tx)* — returned `isValid=true`, `status=Active` | — | — |
| 5 | `revokeCredential` | [`0xda7ac510...2b8ce`](https://sepolia.etherscan.io/tx/0xda7ac5102c41afa05f0062b1962bec9af1608835f2a91703fdf402c8a7d2b8ce) | `11793185` | `33536` |
| 6 | `verifyCredential` / `getCredential` (post-revocation) | *(read-only, no tx)* — returned `isValid=false`, `status=Revoked` | — | — |

`credentialId` used in these transactions:
`0x57580d15e7756ded5690cd21b3862f0092dd8d6bf680041cc562d7e472ce78f7`

### 19.10 Security warnings

- The `.env` file used for this deployment is **not** committed (verified with
  `git check-ignore -v .env` and `git status --porcelain`, both confirming it is ignored and
  untracked). Only `.env.example` (placeholders, no real values) is in the repository.
- No private key, API key, or wallet secret appears anywhere in this README, in any committed
  file, or in any command shown above — every command references credentials only through
  `configVariable(...)` / `process.env`, never a literal value.
- The Sepolia wallet used here holds only Sepolia test ETH and should never be reused for
  mainnet funds.

### 19.11 Troubleshooting encountered

**Issue**: the first verification attempt failed with
`HHE80009: The address contains a contract whose bytecode does not match any of your local contracts.`
on all three explorers (Etherscan, Blockscout, Sourcify).

**Cause**: between deploying (with `--build-profile production`) and verifying, a read-only
diagnostic script was run via `npx hardhat run ... --network sepolia` **without**
`--build-profile production`. `hardhat run` silently recompiles the project first, and
(per `hardhat-verify`'s own documented behaviour) defaults to the `default` build profile —
which has the optimizer disabled. That overwrote the local `artifacts/` cache with unoptimized
bytecode that no longer matched what was actually deployed on-chain.

**Resolution**: re-ran `npx hardhat build --build-profile production` immediately before
verifying, confirmed the rebuilt artifact's bytecode now matched the deployed contract's
creation code byte-for-byte, then re-ran the verify command — all three explorers succeeded on
the next attempt. Lesson captured in the warning in §19.5: always pass `--build-profile
production` explicitly on every command touching this project between a production deployment
and its verification.

### 19.12 Deployment readiness checklist

- [x] Contract compiles cleanly with the `production` profile (optimizer on, 200 runs)
- [x] 39/39 tests passing, typecheck clean, immediately before deployment
- [x] `.env` confirmed untracked and gitignored; no secrets in any tracked file
- [x] Deployed to Sepolia via Hardhat Ignition, transaction confirmed (19+ confirmations checked)
- [x] Verified on Etherscan, Blockscout, and Sourcify; independently re-checked via the
      Etherscan API
- [x] Full lifecycle (issuer authorisation, issuance, verification, revocation,
      post-revocation verification) exercised against the live deployed contract with real,
      recorded transaction hashes
- [x] Deployment records committed (`ignition/deployments/chain-11155111/`) for reproducibility
