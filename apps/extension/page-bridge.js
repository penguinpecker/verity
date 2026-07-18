// Isolated content script on integrating apps: relays window.verity requests from
// provider.js to the background worker, and results/status back to the page.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__verity !== 'request') return
  const { id, opts } = e.data
  try {
    chrome.runtime.sendMessage({ type: 'page-request', id, flow: opts.flow, claims: opts.claims }, (ack) => {
      const err = chrome.runtime.lastError ? 'Verity extension unavailable — reload the page.' : ack && ack.error
      if (err) window.postMessage({ __verity: 'result', id, result: { error: err } }, location.origin)
    })
  } catch {
    window.postMessage({ __verity: 'result', id, result: { error: 'Verity extension unavailable — reload the page.' } }, location.origin)
  }
})

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return
  if (msg.type === 'verity-result') window.postMessage({ __verity: 'result', id: msg.id, result: msg.result }, location.origin)
  else if (msg.type === 'verity-status') window.postMessage({ __verity: 'status', id: msg.id, stage: msg.stage }, location.origin)
})
