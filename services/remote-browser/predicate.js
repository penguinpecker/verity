// Privacy-preserving age predicate.
//
// To prove "age >= N" WITHOUT revealing the date of birth, we build a regex with
// NO capture group that matches the DOB in the response ONLY IF the birth year is
// old enough to guarantee the person is at least N. The attestor signs the claim
// only when the regex matches, so the proof reveals a single bit — yes — and the
// DOB bytes are redacted from the transcript. Nothing (not the DOB, not the name)
// is revealed to the app or written on-chain.
//
// We gate on birth YEAR <= (currentYear - minAge - 1). That is deliberately
// conservative: everyone born in that year or earlier is unambiguously >= minAge
// regardless of month/day, so there are ZERO false positives (we never say "yes"
// for someone under age). The trade-off is a false "no" for people born in the
// current cutoff year who have already had their birthday — acceptable for a gate
// that must never wave through a minor.

/** Regex fragment matching any 4-digit year from 1900 through maxYear (<= 2099). */
function yearAtMost(maxYear) {
  const parts = []
  // 1900–1999
  if (maxYear >= 1999) parts.push('19\\d\\d')
  else if (maxYear >= 1900) {
    const t = Math.floor((maxYear - 1900) / 10) // tens digit reachable fully
    if (t > 0) parts.push(`19[0-${t - 1}]\\d`)
    parts.push(`19${t}[0-${maxYear % 10}]`)
  }
  // 2000–maxYear (maxYear assumed < 2100 for our use)
  if (maxYear >= 2000) {
    const dec = Math.floor((maxYear - 2000) / 10)
    if (dec > 0) parts.push(`20[0-${dec - 1}]\\d`)
    parts.push(`20${dec}[0-${maxYear % 10}]`)
  }
  return `(?:${parts.join('|')})`
}

/**
 * Build the age-predicate matcher for a flow.
 * @param {number} minAge
 * @param {Date} now
 * @returns {{ maxBirthYear:number, matchers:string[] }} regex strings (no capture group)
 *   covering the common DOB serialisations. The prover tries each; a match => yes.
 */
export function buildAgePredicate(minAge, now = new Date()) {
  const maxBirthYear = now.getUTCFullYear() - minAge - 1
  const Y = yearAtMost(maxBirthYear)
  // DD-MM-YYYY / DD/MM/YYYY  (Aadhaar, most Indian portals)
  const dmy = `\\b\\d{2}[-/]\\d{2}[-/]${Y}\\b`
  // YYYY-MM-DD  (ISO, ID.me / many US JSON APIs)
  const ymd = `\\b${Y}-\\d{2}-\\d{2}\\b`
  // MM/DD/YYYY  (US display)
  const mdy = `\\b\\d{2}/\\d{2}/${Y}\\b`
  return { maxBirthYear, matchers: [dmy, ymd, mdy] }
}
