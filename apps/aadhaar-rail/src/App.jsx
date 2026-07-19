import { useEffect, useState } from 'react'
import { LogInWithAnonAadhaar, useAnonAadhaar, AnonAadhaarProof } from '@anon-aadhaar/react'

// The Aadhaar rail, end to end:
//  1. User scans / uploads their Aadhaar Secure QR — proving runs IN THE BROWSER
//     (snarkjs). Nothing (number, name, DOB) leaves the device.
//  2. We reveal ONLY `revealAgeAbove18`.
//  3. The proof is POSTed to the Verity backend, which verifies the UIDAI signature
//     and re-attests a yes/no onto the Horizen verifier (same trust anchor as every
//     other rail). No login, no OTP, no extension, no server egress.
// Same-origin serverless API on Vercel (/api/prove-aadhaar). No separate backend.
const VERITY_API = import.meta.env.VITE_VERITY_API || '/api/prove-aadhaar'
// Dev uses UIDAI's TEST Aadhaar (AnonAadhaarProvider _useTestAadhaar). Set false in prod.
const TEST_MODE = true
// A per-app seed so the same person yields a stable-but-app-scoped nullifier.
const NULLIFIER_SEED = 141592653

export default function App() {
  const [anonAadhaar] = useAnonAadhaar()
  const [latestProof, setLatestProof] = useState(null)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (anonAadhaar.status === 'logged-in') {
      setLatestProof(anonAadhaar.anonAadhaarProofs)
      submit(anonAadhaar.anonAadhaarProofs)
    }
  }, [anonAadhaar.status])

  async function submit(proofs) {
    setErr(null); setResult(null)
    try {
      const r = await fetch(VERITY_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claims: ['age_over_18'], proofs, testMode: TEST_MODE }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(j.error || 'verification failed')
      setResult(j)
    } catch (e) { setErr(String(e.message || e)) }
  }

  return (
    <main style={S.wrap}>
      <p style={S.eyebrow}>VERITY · AADHAAR RAIL · in-browser zk</p>
      <h1 style={S.h1}>Prove you're 18+ from your Aadhaar — reveal nothing else.</h1>
      <p style={S.lede}>
        Scan your Aadhaar Secure QR. The proof is generated on this device; your number,
        name, and date of birth never leave it. No login, no OTP, no extension.
      </p>

      <div style={S.card}>
        <LogInWithAnonAadhaar nullifierSeed={NULLIFIER_SEED} fieldsToReveal={['revealAgeAbove18']} />
        <p style={S.status}>status: <b>{anonAadhaar.status}</b></p>
      </div>

      {result && (
        <div style={{ ...S.card, borderColor: result.pass ? '#5ef2a0' : '#ff6b6b' }}>
          <div style={S.verdict}>{result.pass ? 'YES' : 'NO'}</div>
          <p style={S.sub}>{result.pass ? 'age ≥ 18 — proven, DOB never revealed' : (result.reason || 'not satisfied')}</p>
          {result.tx && <a href={result.explorer} target="_blank" rel="noopener" style={S.link}>on-chain tx ↗</a>}
        </div>
      )}
      {err && <p style={S.err}>{err}</p>}

      {latestProof && anonAadhaar.status === 'logged-in' && (
        <details style={S.details}><summary>raw proof</summary>
          <AnonAadhaarProof code={JSON.stringify(latestProof, null, 2)} />
        </details>
      )}
    </main>
  )
}

const S = {
  wrap: { maxWidth: 640, margin: '0 auto', padding: '48px 24px', fontFamily: 'system-ui, sans-serif', color: '#e9ecef', background: '#070809', minHeight: '100vh' },
  eyebrow: { fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.2em', color: '#5ef2a0' },
  h1: { fontSize: 30, lineHeight: 1.15, margin: '14px 0' },
  lede: { color: '#868f99', fontSize: 15, lineHeight: 1.6 },
  card: { marginTop: 24, padding: 20, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, background: '#0c0e11' },
  status: { fontFamily: 'monospace', fontSize: 12, color: '#868f99', marginTop: 12 },
  verdict: { fontSize: 44, fontWeight: 700, color: '#5ef2a0' },
  sub: { color: '#868f99', fontSize: 13, marginTop: 6 },
  link: { color: '#5ef2a0', fontSize: 13, fontFamily: 'monospace' },
  err: { color: '#ff6b6b', fontFamily: 'monospace', fontSize: 13, marginTop: 16 },
  details: { marginTop: 20, color: '#565d66', fontSize: 12 },
}
