// Verity remote-browser verification flows.
//
// Each flow is a REAL source the user already has an account with. The user logs
// in inside a Verity-hosted browser (no extension, no API credentials, no OTP ever
// seen by Verity). We watch the network for the authenticated response that carries
// the target field, re-witness that request through the attestor with the session
// cookie redacted, and reduce the field to a single yes/no predicate.
//
// `detect` identifies WHICH captured response to prove: its body must match this.
// Nothing here is a sandbox — every flow points at the real production login.

export const FLOWS = {
  'aadhaar-age': {
    id: 'aadhaar-age',
    region: 'IN',
    title: 'Aadhaar age check',
    source: 'myAadhaar · UIDAI (Govt. of India)',
    loginUrl: 'https://myaadhaar.uidai.gov.in/',
    hint: 'Sign in with your Aadhaar number + the OTP sent to your phone. Verity never sees your number, OTP, name, or photo — only whether your age clears the threshold.',
    kind: 'age',
    minAge: 18,
    // The myAadhaar profile response carries the date of birth.
    detect: /("dob"|"dateOfBirth"|"date_of_birth"|"dateOfbirth")\s*:\s*"?\s*\d{2}[-/]\d{2}[-/](?:19|20)\d\d|\b\d{2}[-/]\d{2}[-/](?:19|20)\d\d\b/i,
    question: 'Is this person 18 or older?',
    reveals: 'age ≥ 18  (a single yes / no)',
    hides: 'date of birth, Aadhaar number, name, address, photo, gender',
    // Selective-disclosure matchers (used ONLY when the app requests — and the user
    // approves — revealing a field). Each variant is tried until the attestor can
    // witness one against the real profile response; named group = revealed value.
    fields: {
      name: [
        '"(?:name|fullName|full_name|residentName|resident_name|localName)"\\s*:\\s*"(?<name>[^"\\\\]{2,80})"',
      ],
      dob: [
        '"(?:dob|dateOfBirth|date_of_birth|dateOfbirth|birth_date|birthDate)"\\s*:\\s*"(?<dob>[0-9]{1,4}[-/][0-9]{1,2}[-/][0-9]{1,4})"',
      ],
    },
  },

  'us-age-idme': {
    id: 'us-age-idme',
    region: 'US',
    title: 'US age check',
    source: 'ID.me (verified US identity)',
    loginUrl: 'https://account.id.me/',
    hint: 'Sign in to your existing ID.me account. Verity never sees your birth date, SSN, or documents — only whether you clear the age threshold. No developer keys, no OAuth app.',
    kind: 'age',
    minAge: 21,
    // ID.me profile responses carry an ISO birth_date.
    detect: /("birth_date"|"birthDate"|"dob"|"dateOfBirth")\s*:\s*"?\s*(?:19|20)\d\d-\d{2}-\d{2}|\b(?:19|20)\d\d-\d{2}-\d{2}\b/i,
    question: 'Is this person 21 or older?',
    reveals: 'age ≥ 21  (a single yes / no)',
    hides: 'date of birth, SSN, legal name, address, document images',
    fields: {
      name: [
        '"(?:first_?name|fname)"\\s*:\\s*"(?<name>[^"\\\\]{2,80})"',
        '"(?:name|fullName|full_name|legal_name|legalName)"\\s*:\\s*"(?<name>[^"\\\\]{2,80})"',
      ],
      dob: [
        '"(?:birth_date|birthDate|dob|dateOfBirth)"\\s*:\\s*"(?<dob>[0-9]{4}-[0-9]{2}-[0-9]{2})"',
        '"(?:birth_date|birthDate|dob|dateOfBirth)"\\s*:\\s*"(?<dob>[0-9]{1,2}/[0-9]{1,2}/[0-9]{4})"',
      ],
    },
  },
}

export const getFlow = (id) => FLOWS[id] || FLOWS['aadhaar-age']

export const flowList = () =>
  Object.values(FLOWS).map((f) => ({
    id: f.id, region: f.region, title: f.title, source: f.source,
    hint: f.hint, question: f.question, reveals: f.reveals, hides: f.hides,
  }))
