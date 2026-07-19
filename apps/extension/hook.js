// Runs in the PAGE's own JS context (MAIN world) at document_start. It watches the
// portal's own fetch/XHR calls — the ones the site makes after you log in — and when a
// response carries a date of birth, it reports ONLY that endpoint's URL to the
// extension. The DOB value never leaves the page here; the attestor re-witnesses the
// request itself. Nothing is sent anywhere from this script except the URL.
(() => {
  const DOB = /"?(?:dob|date_?of_?birth|birth_?date)"?\s*[:=]\s*"?\s*\d{1,4}[-/]\d{2}[-/]\d{1,4}|\b\d{2}[-/]\d{2}[-/](?:19|20)\d\d\b|\b(?:19|20)\d\d-\d{2}-\d{2}\b/i

  const report = (rawUrl, method) => {
    try { const url = new URL(rawUrl, location.href).href; window.postMessage({ __verity: 'captured', url, method: method || 'GET' }, location.origin) } catch { /* ignore */ }
  }

  const origFetch = window.fetch
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args)
    // Sniff the body DETACHED — never delay returning the response. Awaiting
    // clone().text() here would block the page's own fetch until the body ends,
    // deadlocking any streaming (SSE/long-poll) endpoint the portal uses.
    try {
      res.clone().text()
        .then((txt) => { if (txt && DOB.test(txt)) report(res.url || (typeof args[0] === 'string' ? args[0] : args[0] && args[0].url), (args[1] && args[1].method) || 'GET') })
        .catch(() => { /* opaque/streamed — skip */ })
    } catch { /* unclonable — skip */ }
    return res
  }

  const origOpen = XMLHttpRequest.prototype.open
  const origSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) { this.__v_url = url; this.__v_method = method; return origOpen.apply(this, arguments) }
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => { try { if (this.responseText && DOB.test(this.responseText)) report(this.__v_url, this.__v_method) } catch { /* */ } })
    return origSend.apply(this, arguments)
  }
})()
