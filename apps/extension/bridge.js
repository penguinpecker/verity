// Isolated content script: the only bridge between the page and the extension. It
// forwards the captured ENDPOINT URL (never the DOB) from hook.js to the background
// service worker.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__verity !== 'captured') return
  try { chrome.runtime.sendMessage({ type: 'captured', url: e.data.url, method: e.data.method || 'GET' }) } catch { /* worker asleep */ }
})
