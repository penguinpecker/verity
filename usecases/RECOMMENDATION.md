# Verity — Use-Case Recommendation

**Prepared for:** Verity (self-hosted, Reclaim-style zkTLS attestor)
**Date:** 2026-07-18
**Question answered:** Which **two** real-world verification use cases should we build **alongside the Aadhaar age-check** anchor — with at least one clearly US-based?

**Answer in one line:** Build **(1) US Age Verification** — the same age-predicate as Aadhaar pointed at a US data source under the hardest regulatory mandate in the space — and **(2) Financial-Standing Proofs (income + proof-of-funds)** — a global, crypto-native vertical already proven end-to-end by a live competitor. Together with Aadhaar they form a trio that shares one attestor, one predicate engine, and one pitch ("prove a threshold, reveal nothing, create no honeypot").

---

## Pick 1 — US Age Verification *(the clearly US-based pick)*

**Punchy name:** **AgePass US** — "Prove you're 21, upload nothing."

**One-line pitch:** The user proves `age ≥ 18/21` from an identity they already hold, and the adult site, alcohol/cannabis checkout, or app store receives a signed boolean instead of a driver's-license photo.

**Regulatory / market driver (specifics):**
- **Free Speech Coalition v. Paxton** (SCOTUS, 2025-06-27, 6–3) upheld mandatory online age verification under intermediate scrutiny — the constitutional obstacle is gone.
- **~25 US states** have adult-content age-verification laws in force (West Virginia commonly cited as ~26th, mid-2026). **Texas HB 1181** carries up to **$10,000/day**, an extra **$10,000/day for illegally retaining identifying info**, and up to **$250,000 if a minor is exposed**; Texas already sued Pornhub's parent (~$1.6M accrued).
- Parallel mandates: **UK Online Safety Act** (OFCOM HEAA enforceable 2025-07-25; up to £18M or 10% of global revenue; 90+ investigations, £800k Kick fine Feb 2026) and **App Store Accountability Acts** (Utah first, compliance deadline 2026-05-06; federal bill pending).
- Both Texas and Virginia statutes explicitly bless a **"transactional data / commercially reasonable" method** — i.e. proving age from an account you already have, which is exactly the zkTLS surface.

**Exact data source (what the user logs into):** **ID.me** — a web IdP with a standard **OAuth 2.0 / OpenID Connect** API whose UserInfo/attributes response returns a verified **`birth_date`** field. ~156M US users already hold a verified ID.me identity, so onboarding is one login click. (Fallback sources: bank/credit-bureau consumer portals — but those are weaker, see feasibility.)

**Precise predicate:** a single boolean `age_over_21 = true` (range proof `DOB ≤ today − 21y`), signed by the attestor and bound to the requesting app's nonce.
**Stays hidden:** exact date of birth, name, address, document number, which source was used, and everything else in the response.

**No-extension web flow — feasible?** **Yes, this is the cleanest "yes" in the whole space.** ID.me is a real **OAuth/OIDC API**, so the user does a standard redirect-and-consent (no browser extension), and the attestor witnesses a **documented JSON `birth_date` field meant to be machine-read** — not a scraped HTML DOM. That makes it far less fragile than a portal proxy. The bank/bureau fallbacks would be **portal-proxy** flows and are the brittle tail (many bank dashboards don't even render DOB, collapsing the strong predicate into a weaker "holds a bank account ⇒ adult" proxy).

**Incumbents displaced:** the ID-scan / selfie / database-lookup pack — **Yoti, Persona, Incode, Veriff, AU10TIX, Intellicheck, Veratad, LexisNexis** — every one of which creates the honeypot that just leaked (Discord Sept 2025 ID/selfie breach; AU10TIX year-long credential exposure). Also out-flanks the **mDL / EU-wallet ZKP** camp, which needs a government to issue a credential first; Verity works today from a login that already exists.

**Privacy edge:** no ID upload, no biometric, **no new breach honeypot** — which turns Texas's "don't retain PII → extra $10,000/day" penalty and the UK OSA's data-minimization rule from a risk into the sales pitch.

**Honest caveats:** ID.me **sells its own age-verification product** (coopetition; ToS diligence required) and Sybil/credential-sharing (a minor can borrow a parent's login) is unsolved by any ZKP scheme — be upfront and pair with liveness where a regulator demands it.

---

## Pick 2 — Financial-Standing Proofs (income + proof-of-funds)

**Punchy name:** **ProofOfMeans** — "Prove you can pay, not your pay stub."

**One-line pitch:** The user proves `income ≥ $X`, `balance ≥ $Z`, or `income ≥ 3× rent` from their own payroll/bank session, and a lender, landlord, or on-chain credit protocol gets one attested predicate instead of statements, an SSN, or a data-broker resale.

**Regulatory / market driver (specifics):**
- **Crypto-native wedge (strongest, build first):** on-chain **undercollateralized lending** is live and *needs* a cryptographic income/asset signal with no bank in the loop. **3Jane** (on Base) already issues unsecured USDC credit lines underwritten with **Reclaim + zkTLS + Plaid** — a working proof that this exact stack ships. DeFi lending TVL ~$75B → $126B+ in 2025; tokenized private credit projected $12–17.5B TVL by 2027.
- **Rental:** landlords require gross income ≥ 3× rent; **>93% of property managers hit application fraud** last year, **AI now forges photorealistic pay stubs**, and Property Shield estimates **~$16B/yr** in landlord losses — a fraud problem PDFs can't fix but a cryptographic attestation can. US tenant-screening market ~$1.5B → ~$2.7B by 2031.
- **Lending:** Fannie Mae **Day 1 Certainty** already pays for "trusted attestation of a number"; income-verification platform market ~$2.7B (2024) → ~$7.3B (2033). CFPB's **data-broker NPRM (Dec 2024)** would treat resale of income data as an FCRA consumer report (status uncertain under 2025 leadership — treat as tailwind, not load-bearing).

**Exact data source (what the user logs into):** primarily **payroll portals** — ADP (`my.adp.com`), Workday, Paychex Flex, Gusto (Reclaim already supports these) — and, as the robust middle path, the **Plaid/aggregator API response** the user's session already holds (the 3Jane pattern). Gig portals (Uber, DoorDash) cover thin-file borrowers.

**Precise predicate:** a threshold/equality over an extracted field — `gross_monthly_income ≥ $X`, `employer == "Acme" && status == active`, `available_balance ≥ $Z`, or a derived `income ≥ 3× rent`.
**Stays hidden:** exact salary, every prior paycheck, employer (when only the amount is asked), account number, balance, transaction history, counterparties, and SSN.

**No-extension web flow — feasible?** **Yes, via two paths, and deliberately not the third.** (a) **Payroll portals** are username/password web logins witnessable through a **hosted proxy/webview** (feasible, but template-brittle on redesigns). (b) **Plaid/aggregator responses** are an **OAuth-like** channel — attest the normalized JSON, the most robust route, and exactly what 3Jane does. **Defer direct bank-portal scraping** (Chase/BofA/Wells): TLS/JA3-JA4 + device fingerprinting + MFA make a witnessed automated session look like credential-stuffing — this is the fragile tail, not the flow.

**Incumbents displaced:** **The Work Number / Equifax** (823M records; sells your payroll history at ~$55–70/pull with you out of the loop) and the credential-harvesting aggregators **Argyle, Pinwheel, Plaid, Truv** (take your real login and over-collect full pay history to prove one number). Verity replaces both with a single user-generated predicate.

**Privacy edge:** no credential handoff, no broker resale, and **data minimization by construction** — the verifier gets one attested boolean instead of statements/PII, shrinking its own FCRA/GLBA/CCPA surface — plus the output is a **composable on-chain input** that no Web2 incumbent can serve.

**Honest caveats:** if the output drives a credit/tenant/employment decision, the verifier (and possibly Verity) may fall under **FCRA** — legal review before US lending/rental GTM. Extraction templates break on portal redesigns (ongoing ops tax), and a single self-hosted attestor is a provenance trust bottleneck (rotate/decentralize; 3Jane uses EigenLayer operators).

---

## Ranked shortlist — runners-up (one line each)

1. **Credit-score / creditworthiness-tier** (`score ≥ 700` / tier band from Credit Karma or Experian) — highest-demand *US revenue* fit and a clean single-number predicate with an FCRA privacy edge baked in (validated by zkMe's zkCreditScore on Reclaim and 3Jane), but it's **portal-proxy only** (no OAuth, aggressive bot-defense) and risks being treated as a consumer-report resale — folds naturally into Pick 2 as the credit leg.
2. **Proof-of-personhood / Sybil + social-account ownership** (X/GitHub/Discord account-age and reputation signals) — **highest feasibility for a small team**, crypto buyers, on-chain settlement, minimal regulatory friction, but only *partial* personhood vs. World ID and low value per proof — the fastest wedge to first revenue, a poor flagship.
3. **Government / veteran benefit-income** (SSA "my Social Security", VA.gov, benefit-verification letter → `benefit_income ≥ $X` / `is_veteran`) — rich data and real rental/discount demand, but the source sits behind **ID.me/Login.gov government gatekeepers** with heavy ToS and institutional blast-radius risk.
4. **Reusable KYC across exchanges** ("KYC-passed at a Tier-1 venue, country ≠ sanctioned") — genuine pain and maturing standards (W3C VC 2.0, OpenID4VP 1.0), but regulators generally forbid one venue *relying* on another's KYC, so it only works as a risk signal, not compliance.

*Avoid leading with:* degree-for-hiring (alumni lose portal access; canonical source is a verifier-pull DB), professional licenses (already public → zkTLS redundant), employment-history DBs (verifier-pull), and student discounts (SheerID/UNiDAYS own it cheaply, low sensitivity).

---

## Verdict — why these two + Aadhaar are the strongest trio

Two of the three legs ride the **single hardest, most-penalized regulatory mandate in the entire space** — age verification, anchored by Aadhaar in India and by *Paxton* + ~25 states (and the UK OSA) in the US — which maximizes the rarest thing a startup can sell into: buyers who **must** comply, on a deadline, under daily fines. Because Aadhaar age and US age are the **identical predicate on one product surface**, the US extension ships off the Aadhaar machinery with near-zero redesign and carries the cleanest feasibility story we have (ID.me's OAuth `birth_date` is a real API, not a scraper). The third leg — financial-standing proofs — is the deliberate diversification into a **higher-value, globally-applicable, crypto-native** vertical that a live competitor (3Jane) has already proven end-to-end with this exact stack, and whose DeFi GTM is the **fastest path to a paying integration** for a small team. Critically, all three are mechanically the same thing — *prove a threshold about yourself, reveal nothing else, create no new honeypot* — so **one self-hosted attestor and one predicate engine serve the whole trio**, and every source we lead with (ID.me OAuth, Plaid, payroll portals) is a documented or login-native response, keeping us off the fragile direct-bank-scrape path that would sink feasibility.
