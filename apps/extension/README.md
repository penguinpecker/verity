# Verity extension — on-device age proofs

Prove `age ≥ 18` (Aadhaar / India) or `age ≥ 21` (ID.me / US) from a portal you already
log into — and hand the app a single **yes / no**. The login happens in **your own
browser** (your residential IP, your real fingerprint), so there is no bot wall and no
proxy, and your credentials/OTP/DOB are never shared with the app.

## How it works
1. `hook.js` runs in the portal page and watches the site's own network calls. When a
   response carries a date of birth, it reports **only that endpoint's URL** (never the
   DOB) to the extension.
2. On **Prove**, `background.js` reads the session cookie for that domain **on-device**
   (including HttpOnly) and posts `{ flow, endpoint, cookieStr }` to the Verity attestor
   backend.
3. The attestor re-witnesses that request over TLS with the cookie redacted and proves a
   **no-capture-group age predicate** (birth year ≤ cutoff) — so the DOB itself is never
   revealed. The signed yes/no is recorded on the Horizen-mainnet verifier.

## Load it (unpacked)
1. Open `chrome://extensions`, enable **Developer mode** (top-right).
2. **Load unpacked** → select this `apps/extension` folder.
3. Pin **Verity**, open the popup, click a portal (or just browse to
   `myaadhaar.uidai.gov.in` / `account.id.me`).
4. **Log in with your real credentials.** Open your profile page so the site fetches your
   details — the popup flips to “Profile data detected”.
5. Click **Prove it** → you get YES/NO + an on-chain tx link. The app only ever sees the
   boolean.

## For integrating apps (window.verity)
On integrating origins (the Verity demo site, localhost) the extension injects a
`window.verity` provider — the thing `@verity/sdk/browser` wraps:

```js
const res = await window.verity.request({ flow: 'aadhaar-age', claims: ['age', 'name', 'dob'] })
res.claims   // { age_over_18: true, name: '…', dob: '…' }  — attestor-signed
```

The extension opens the portal, the user logs in on-device, and the proof runs
automatically when the profile response appears; the promise resolves with the
claims and the on-chain tx of the age gate. `'age'` is always a yes/no predicate;
`'name'`/`'dob'` are selective disclosures the user sees in the request and can
decline by simply not completing the login. See `/integrate.html` on the demo site
for the live example.

## Honest caveat (being tested)
zkTLS witnesses the request through the attestor, so the *proof fetch* originates from the
attestor's IP even though your login was on your own IP. Portals that gate **authenticated
API calls** on IP (not just session) may still refuse it — this is source-specific and
resolved by a clean/in-region attestor IP. The login-bot-wall problem is solved by
on-device; this last hop is what your real-login test will confirm per source.

Backend: `https://verity-browser-production.up.railway.app/api/prove-session`
