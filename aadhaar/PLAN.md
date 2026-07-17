# PLAN — Verity Aadhaar Age-Check (`age >= 18`, no browser extension, app gets only YES/NO)

**Goal.** An app asks Verity *"is this user ≥ 18?"*. The **user** authenticates with their **real Aadhaar** (via DigiLocker), a **zkTLS proof of the age predicate** is generated on **Verity's own self-hosted attestor** with **no browser extension and no forced mobile app**, and the app receives **only YES/NO** — never the DOB, the Aadhaar number, or the login credential.

This plan is grounded in the existing Verity monorepo (working `@verity/sdk` → `createClaimOnAttestor`; attestor live at `wss://verity-attestor-production.up.railway.app/ws`, signer `0x710F…8bd1`; `VerityVerifier` live on Horizen mainnet `0x85804b684Ce86AC1773950161886741862EE9DBB`; and a KYC sandbox in `apps/demo/server.js` that **already demonstrates the exact redaction pattern**) and the research in `aadhaar/parts/a1–a4`.

---

## 1. BLUF — the single best no-extension web architecture

**Build the `Attested-OAuth Age Gate`: DigiLocker OAuth 2.0 (login + consent on DigiLocker's own domain) → Verity backend receives a short-lived Bearer token → Verity runs a *server-side* zkTLS claim on its **own attestor** over DigiLocker's `Authorization: Bearer` user endpoint, using a **regex age-predicate with no capture group** so the attestor signs iff DOB ≤ the 18-years cutoff → the app is handed a signed YES/NO (optionally recorded on the Horizen `VerityVerifier`). No extension, no webview, no mobile app, no cross-origin session capture.**

**Is `DigiLocker OAuth + zkFetch` cleaner than proxying the portal UI? — Decisively yes, and proxying is in fact *impossible* for pure no-extension web.** A page on `verity.com` **cannot** capture a `myaadhaar.uidai.gov.in` / `digilocker.meripehchaan.gov.in` session: Same-Origin Policy + HttpOnly cookies + `X-Frame-Options`/`frame-ancestors` make a foreign origin's authenticated session unreadable to page JS (`a4 §2`). That isolation is *exactly why* Reclaim ships a browser extension (`chrome.cookies` bypasses SOP), a mobile in-app WebView SDK, or a **server-side remote browser in a TEE** (`a1 §4b`) — none of which is a plain-web, self-hosted primitive. **OAuth sidesteps the whole capture problem:** the login happens on DigiLocker's domain and hands Verity a legitimate token, so the zkTLS layer degrades to the well-trodden **"prove an HTTPS call made with an app-held credential"** case that `createClaimOnAttestor`/zkFetch already do today (`a4 §5`, `13-zkfetch`).

**One honesty flag carried from `a4 §5.5`:** because OAuth already gives Verity the DOB directly, the attestor/zkTLS layer is only *load-bearing when the asking app is a different party than Verity* (which is the task's framing — "an app asks Verity"). Then the signed, DOB-free proof lets the app trust *DigiLocker + Verity's attestor* instead of *Verity's word*, and lets the YES/NO be verified independently or on-chain. If Verity were also the relying app, plain OAuth would suffice and the attestor would be redundant. We are building the third-party case, so the attestor earns its keep.

---

## 2. End-to-end flow — exact components and where each runs

```mermaid
sequenceDiagram
    participant App as Relying App (3rd party)
    participant U as User (desktop browser, no extension)
    participant V as Verity backend (OAuth client + prover)
    participant DL as DigiLocker (meripehchaan.gov.in)
    participant AT as Verity Attestor (self-hosted, Railway; IN egress)
    participant HZ as VerityVerifier (Horizen L3, optional)

    App->>V: POST /agecheck/start {callbackUrl, appId, ref} (server-to-server)
    V-->>App: { verifyUrl, sessionId }
    App-->>U: redirect / open verifyUrl (Verity-hosted page)
    U->>V: GET /verify/start (click "Verify my age with Aadhaar")
    V->>V: mint state + PKCE (code_verifier/code_challenge), bind to sessionId
    V-->>U: 302 to DL /public/oauth2/1/authorize?...(PKCE, scope=ADHAR)
    U->>DL: LOGIN on DigiLocker's own domain (Aadhaar/mobile + OTP) + consent
    DL-->>U: 302 back to V /verify/callback?code&state
    U->>V: GET /verify/callback?code&state
    V->>DL: POST /public/oauth2/2/token (code + code_verifier + client creds)
    DL-->>V: { access_token (Bearer), dob(DDMMYYYY), ... }
    Note over V,AT: Verity now holds a legit session — NO cookie theft
    V->>AT: createClaimOnAttestor(name:http, url=/oauth2/1/user,\n secretParams.Authorization=Bearer, AGE-PREDICATE match, geoLocation:IN)
    AT->>DL: zkTLS tunnel (opaque proxy, validates cert/SNI)
    DL-->>AT: response (Bearer redacted; only dob region revealed to attestor)
    AT-->>V: signs claim IFF predicate matches (else throws → NO proof)
    V->>V: verifyProof + pin providerHash + freshness/replay + parse YES/NO
    opt on-chain receipt
      V->>HZ: verifyAndRecord(toOnchainProof(proof)) — real tx
      HZ-->>V: ProofVerified(identifier)
    end
    V-->>App: POST callbackUrl { over18: true|false, sessionId, ref, proof? }
    App-->>U: grant / deny (DOB never seen by App)
```

**Who runs where:**

| Component | Where it runs | Responsibility |
|---|---|---|
| Relying app | its own infra | asks the question; receives YES/NO on its callback; never sees DOB/Aadhaar |
| **Login capture** | **DigiLocker's own domain** (`/public/oauth2/1/authorize`) | user types Aadhaar/mobile + OTP on DigiLocker; Verity never sees credentials. This *is* the "no-extension capture" — it is OAuth, not session scraping |
| Verity hosted verify page | Verity backend (static + routes) | "Verify my age" button → `/verify/start`; success/return UI. Presentation only — it does **not** and **cannot** capture the session |
| OAuth handler | Verity backend (Node) | Authorization-Code + PKCE; exchanges `code`→Bearer token; holds token **server-side, short-lived** |
| **Age predicate + prover** | Verity backend (Node, `@verity/sdk`) | `createClaimOnAttestor` over DigiLocker's Bearer endpoint with the predicate regex; redacts the token; reveals only the DOB region to the attestor |
| **Verity attestor** | self-hosted (Railway) — **needs IN egress** for gov endpoints | opaque TLS proxy: validates DigiLocker's cert/SNI, re-runs the predicate over the revealed bytes, **signs iff ≥18** |
| Callback | Verity backend → app's `callbackUrl` | authoritative delivery of `{ over18, sessionId, ref, proof? }` (server-to-server) |
| On-chain verify (optional) | `VerityVerifier` on Horizen mainnet (`0x8580…9DBB`) | `verifyAndRecord` recovers the attestor ECDSA sig against the trusted set; emits `ProofVerified`. Optional tamper-evident public receipt |

---

## 3. The age-predicate technique (yes/no without revealing DOB)

**Mechanism (from `a3`).** Reclaim/Verity does **not** do a numeric comparison or a ZK range circuit. The attestor **re-runs a regex** (`responseMatches`) over the revealed slice of the TLS response; **if it matches, the attestor signs — the mere existence of a valid signed proof is the boolean `true`; if it fails and isn't inverted, the attestor throws and no proof exists (that absence is the `NO`)** (`a3 §1, §6`). So we **encode "≥ 18" as a regex that only matches qualifying birth-dates, and we omit any named capture group** so the DOB never lands in `extractedParameters` (`proof.data` stays `{}`) — the app gets YES/NO with no DOB.

**Concrete predicate — DigiLocker DOB is `DDMMYYYY`** (per `a4 §5.1`, e.g. `14032001`), not ISO. Today = 2026-07-18 → eligible iff DOB ≤ 2008-07-18. Day-precise, no capture group:

```
"dob":"(?:\d{2}\d{2}(?:19\d{2}|200[0-7])|\d{2}0[1-6]2008|(?:0[1-9]|1[0-8])072008)"
```
- `\d{2}\d{2}(?:19\d{2}|200[0-7])` — any day/month, birth year 1900–2007
- `\d{2}0[1-6]2008` — born 2008, Jan–Jun (any day)
- `(?:0[1-9]|1[0-8])072008` — born 2008-07, day 01–18

**Simpler default — year granularity** (rotates once a year, minimal attestor exposure, slightly over-admits people born later in the cutoff year):
```
"dob":"\d{4}(?:19\d{2}|200[0-8])"     # born 1900–2008
```

**Sandbox predicate — the KYC sandbox uses ISO `YYYY-MM-DD` (`dob:"2001-03-14"`), so we can test the whole pipeline TODAY** with the ISO form of the same predicate (`a3 §2a`):
```
"dob":"(?:(?:19\d{2}|200[0-7])-\d{2}-\d{2}|2008-0[1-6]-\d{2}|2008-07-(?:0[1-9]|1[0-8]))"   # matches 2001-03-14 → YES
```

**What leaks vs. hides (`a3 §2d`):**
- **App:** learns only YES/NO (+ the public predicate/cutoff). No DOB — we omit the named group.
- **Attestor:** must see the bytes it matches, so the *revealed DOB slice* passes through Verity's **own, stateless** attestor for milliseconds and is stored nowhere. Minimise it: reveal only the `"dob":"…"` token (anchoring needs the key visible — see `a3 §1` on redaction stripping structure), and prefer year-granularity when legally acceptable so the attestor sees only the birth year.
- **Predicate is public** (hashed into the provider/claim identifier and signed) — the proof reveals *which* cutoff was checked, which is fine and desirable.

**Two things stock Reclaim/Verity CANNOT do (be honest — `a3 §4, §8`):** (a) hide the DOB from the *attestor* while still comparing it — that needs either a source-provided pre-computed `ageOver18` boolean (DigiLocker doesn't return one) or a custom ZK comparator circuit Reclaim doesn't ship; (b) OPRF does **not** express `≥` — it's a nullifier, not an order relation. Use OPRF only for the *complementary* "one-Aadhaar-one-token" Sybil control (hash the Aadhaar/`digilockerid` in the same proof), never for the age comparison itself (`a3 §5`).

**Delivery / verify (`a3 §6`):** app registers a `callbackUrl`; Verity POSTs `{ over18, sessionId, ref, proof? }` server-to-server (authoritative — never trust a browser redirect param). If the app wants to check independently, it runs `verifyProof(proof, { trustedAttestors: ['0x710F…8bd1'] })` **AND pins Verity's age-provider hash / today's provider version** (so a user can't replay a weaker/older predicate) **AND checks session freshness/replay**. YES = valid signature ∧ pinned predicate ∧ fresh session.

---

## 4. Buildable NOW vs. needs the user's real DigiLocker login

**Buildable and testable NOW (zero DigiLocker dependency — the whole architecture minus the real IdP):**
- The **entire prove → predicate → verify → on-chain pipeline**, exercised against the **existing KYC sandbox** (`apps/demo/server.js` `SOURCES.kyc`: bearer-gated `/sandbox/kyc`, token redacted, only `"verified"` revealed, real Horizen tx). This already proves the credential-redaction + on-chain-record half.
- The **age predicate itself**: swap the sandbox `match` from `"status":"(?<value>verified)"` to the **no-capture-group ISO predicate** above over the sandbox `dob:"2001-03-14"`. Confirm YES for 2001, and NO (attestor throws → no proof) for a synthetic under-18 dob. Use the SDK's existing advanced `matches`/`redactions` fields (no named group) so `proof.data` is `{}`.
- The **app-facing surface**: `POST /agecheck/start` (issue sessionId + verifyUrl), the hosted verify page, the **callback POST** `{ over18, sessionId, ref, proof? }`, **provider-hash pinning**, and **session/replay** bookkeeping.
- **OAuth scaffolding** (Authorization-Code + PKCE routes, `state` binding, token exchange, secret handling) — built and unit-tested against a **stub IdP or an aggregator sandbox** (e.g. Setu `dg-sandbox.setu.co`, `a4 §5.1 note`) before real creds land.
- **Daily predicate rotation** (regenerate the day-precise regex + provider version each day) and the backend "pin today's version" check (`a3 §2e`).
- **On-chain receipt** via the already-live `VerityVerifier.verifyAndRecord` (`toOnchainProof` already in the SDK).

**Needs the user's real DigiLocker login to finalize (cannot be faked offline):**
1. **DigiLocker Authorized-Partner credentials** — `client_id` / `client_secret` / registered `redirect_uri` / consented scope (`ADHAR`). This is a **gated KYC/approval onboarding**, not code — **the real long pole** (`a4 §7`). No creds ⇒ no real OAuth.
2. **The exact live response shape** of `GET /public/oauth2/1/user` (or the token response) — confirm the **field name and DOB serialization** (`DDMMYYYY` per the v2.2 spec, but only observable while authenticated) to **finalize the redaction/predicate regex** (`a4 §5.1`, `a2 §2.1` inference caveat). The regex is tightly coupled to the exact serialization.
3. **Attestor IN egress** — gov endpoints are India-geo-restricted (`a2 "honest limitations"`). Confirm whether `digilocker.meripehchaan.gov.in`'s OAuth/user endpoints refuse non-India IPs; if so, give the self-hosted attestor an **IN egress/proxy** and pass `geoLocation: 'IN'` (a small `prove()`/`createClaimOnAttestor` param addition — the SDK doesn't expose `geoLocation` yet).
4. **End-to-end acceptance** — one real logged-in Aadhaar session to confirm the attestor accepts the redacted transcript and the predicate boundary behaves (test cutoff day, ±1).

**Alternative if Authorized-Partner onboarding stalls:** the live **myAadhaar provider path** exists (`a2 §2.1`, provider `e65c13a3-…`, proves `dob` from `tathya.uidai.gov.in`) — but it relies on **live-session cookie capture**, which needs the extension/webview/TEE-remote-browser Verity does not have. So for **no-extension web it is not an option** unless Verity stands up a Reclaim-style TEE remote browser (out of scope, `a1 §6`). OAuth remains the clean web path.

---

## 5. Phased build — with the FIRST shippable milestone

**Milestone 0 — "Attested age gate over the sandbox" (SHIP FIRST; no DigiLocker needed).**
Extend `apps/demo` into an age-check demo that is architecturally identical to the real thing:
- Add the **no-capture-group ISO age predicate** over `SOURCES.kyc` (`dob:"2001-03-14"`) → attestor signs ⇒ **YES**; synthetic under-18 dob ⇒ attestor throws ⇒ **NO**.
- Add app-facing `POST /agecheck/start` + hosted verify page + **callback POST** `{ over18, sessionId, ref, proof? }` (server-to-server), with **provider-hash pin** + **session/replay** dedupe.
- Keep the **optional on-chain `verifyAndRecord`** receipt (already wired).
- **Deliverable:** a live URL where an app gets a signed YES/NO, the DOB is provably absent from the proof, and it verifies on Horizen — the full trust story, minus the real IdP. This de-risks everything and is demoable to partners/regulators immediately.

**Milestone 1 — OAuth scaffolding (against a sandbox IdP).**
Authorization-Code + PKCE routes (`/verify/start`, `/verify/callback`), `state`↔`sessionId` binding, token exchange, short-lived server-side token custody. Wire the prover to read `dob` from the sandbox/aggregator token response and prove the predicate. No real Aadhaar yet.

**Milestone 2 — Real DigiLocker (needs the long-pole items from §4).**
Land Authorized-Partner creds; point OAuth at `digilocker.meripehchaan.gov.in`; **finalize the `DDMMYYYY` predicate** against a real response; add **attestor IN egress + `geoLocation:'IN'`**; run the real end-to-end acceptance + boundary tests. Flip the demo's sandbox source to the real DigiLocker source behind a flag.

**Milestone 3 — Hardening / productionization.**
Daily predicate rotation + "pin today's version"; **OPRF nullifier on `digilockerid`/Aadhaar** for one-person-one-adult-token (same proof, `a3 §5`); attestor auth-grant with `hostWhitelist:['*.meripehchaan.gov.in']` so only Verity's backend can drive the attestor and only against DigiLocker (`a2 §"what Verity needs"`, `02 §8`); consider a 2nd attestor + `threshold=2` on `VerityVerifier` for multi-witness trust; nothing-sensitive logging on the attestor.

---

## 6. Honest risks

- **DigiLocker Authorized-Partner onboarding is the real blocker, not the tech (`a4 §7`).** It's a vetted KYC/approval process (video onboarding referenced in DigiLocker's FAQ). Mitigation: aggregator (Setu, etc.) to start — at the cost of adding a party to the data/trust chain — then go direct.
- **A pure-web, no-extension flow is genuinely possible — but only via OAuth, and it requires a hosted verifier that Verity runs.** There is **no** browser primitive to capture a foreign origin's session without an extension/webview/TEE-remote-browser (`a4 §2`). So "no extension" is achievable, but "no server we run" is not: Verity must host the OAuth handler + prover. This is a real dependency, not a client-only trick.
- **The proof attests the API call, not the person (`a4 §7`).** zkTLS proves "a GET to DigiLocker with *some* valid Bearer returned a qualifying DOB." Binding it to *this consenting user* comes from the OAuth exchange Verity performed, not from the proof — unless you also commit `digilockerid`/`reference_key` (or a nullifier) into the claim `context`.
- **Attestor transiently sees the DOB slice; single attestor = single trust root (`a3 §7`, `a4 §7`).** Acceptable only because it's Verity's *own, stateless* attestor. Minimise exposure to the birth year; log nothing; consider multi-attestor threshold for cross-org trust.
- **Predicate brittleness (`a3 §2e`).** The regex is bolted to DigiLocker's exact `DDMMYYYY` serialization and to a moving cutoff. Day-precise regexes must **rotate daily** and the backend must **pin today's version** or a user replays last year's easier cutoff. Gov endpoints can change without notice (`a2`), breaking the provider.
- **Geo-restriction (`a2`).** Without an IN egress the DigiLocker/UIDAI calls fail; provisioning compliant IN egress for a signing attestor is an ops item to validate early.
- **Redundancy in the trivial case (`a4 §5.5`).** If the asking app ever equals Verity, the attestor is overhead over plain OAuth. Keep the zkTLS layer justified by the third-party/on-chain-verifiable requirement.
- **DOB-secret-from-everyone is out of scope (`a3 §4`).** A ZK range proof that hides the DOB from the attestor too would need a custom comparator circuit Reclaim doesn't ship — do not promise it.

---

## Source map
- Research: `aadhaar/parts/a1-verification-flow.md`, `a2-authed-providers-aadhaar.md`, `a3-age-predicate.md`, `a4-verity-selfhost-gap.md`.
- Core context: `parts/02-docs-concepts-core.md` (proof anatomy, verify/pin/replay, attestor auth), `parts/13-zkfetch.md` (app-held-credential backend mode, secretParams redaction, `geoLocation`, OPRF flags), `parts/14-reclaim-js-sdk.md` (portal/no-extension flow).
- Existing Verity code: `packages/sdk/src/index.js` (`VerityClient.prove`/`verifyProof`/`toOnchainProof`), `apps/demo/server.js` (`SOURCES.kyc` redaction pattern + `verifyAndRecord`), `packages/contracts/contracts/VerityVerifier.sol` (`verifyProof`/`isValidProof`/`verifyAndRecord`, live `0x8580…9DBB`), `services/attestor` (self-hosted witness).
