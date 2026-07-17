const VERIFIER = '0xDe8b9A89DcF74CD1B47802F8e10fCF3D4F56faDd'
const ATTESTOR = '0x710FC3548Ed4F77A8Cffa179639866798Deb8bd1'
const HORIZEN_RPC = 'https://horizen.calderachain.xyz/http'
const EXPLORER = 'https://explorer.horizen.io'
const ABI = [
  'function isValidProof(((string provider,string parameters,string context) claimInfo,((bytes32 identifier,address owner,uint32 timestampS,uint32 epoch) claim,bytes[] signatures) signedClaim) proof) view returns (bool)',
]

// pipeline stages: [event-name-from-attestor OR client marker, label]
const STAGES = [
  ['connecting', 'Connecting to attestor'],
  ['sending-request-data', 'Requesting data over TLS'],
  ['waiting-for-response', 'Witnessing TLS response'],
  ['generating-zk-proofs', 'Generating zero-knowledge proof'],
  ['waiting-for-verification', 'Attestor verifying & signing'],
  ['verify-onchain', 'Verifying on Horizen mainnet'],
]

const $ = (id) => document.getElementById(id)
const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—'

// wire up static links
$('nav-contract').href = `${EXPLORER}/address/${VERIFIER}`
$('nav-attestor').href = `${EXPLORER}/address/${ATTESTOR}`
$('seal-link').href = `${EXPLORER}/address/${VERIFIER}`
$('foot-contract').textContent = VERIFIER

// live price ticker (display only)
async function tick() {
  try {
    const r = await fetch('/api/price')
    const { price } = await r.json()
    if (price) $('live-price').textContent = Number(price).toFixed(2)
  } catch { /* ignore */ }
}
tick(); setInterval(tick, 10000)

function renderSteps() {
  const ol = $('steps'); ol.innerHTML = ''
  STAGES.forEach(([key, label], i) => {
    const li = document.createElement('li')
    li.dataset.key = key
    li.style.animationDelay = `${i * 45}ms`
    li.innerHTML = `<span class="dot"></span><span>${label}</span>`
    ol.appendChild(li)
  })
}
function setStage(key, state) {
  const rows = [...$('steps').children]
  const idx = STAGES.findIndex(s => s[0] === key)
  rows.forEach((li, i) => {
    li.classList.remove('active', 'done')
    if (i < idx) { li.classList.add('done'); li.querySelector('.dot').textContent = '✓' }
    else if (i === idx) {
      if (state === 'done') { li.classList.add('done'); li.querySelector('.dot').textContent = '✓' }
      else { li.classList.add('active') }
    }
  })
}

async function verifyOnChain(onchainProof) {
  setStage('verify-onchain', 'active')
  const provider = new ethers.JsonRpcProvider(HORIZEN_RPC, 26514)
  const c = new ethers.Contract(VERIFIER, ABI, provider)
  const ok = await c.isValidProof(onchainProof)
  if (!ok) throw new Error('contract returned false')
  setStage('verify-onchain', 'done')
  $('seal').hidden = false
}

function run() {
  const btn = $('run')
  btn.disabled = true
  $('err').hidden = true
  $('seal').hidden = true
  $('result').hidden = true
  $('pipeline').hidden = false
  renderSteps()

  const es = new EventSource('/api/prove')
  es.addEventListener('meta', (e) => {
    const m = JSON.parse(e.data)
    $('fact-attestor').textContent = short(m.attestorUrl?.includes('//') ? ATTESTOR : ATTESTOR)
  })
  es.addEventListener('step', (e) => {
    const { name } = JSON.parse(e.data)
    if (STAGES.some(s => s[0] === name)) setStage(name, 'active')
  })
  es.addEventListener('proof', async (e) => {
    const p = JSON.parse(e.data)
    setStage('waiting-for-verification', 'done')
    $('attested-price').textContent = Number(p.data.price).toFixed(2)
    $('fact-attestor').textContent = short(p.attestor)
    $('fact-id').textContent = short(p.identifier)
    $('result').hidden = false
    try {
      await verifyOnChain(p.onchainProof)
    } catch (err) {
      showError('on-chain verify failed: ' + (err.message || err))
    }
    es.close(); done()
  })
  es.addEventListener('error', (e) => {
    let msg = 'attestor error'
    try { msg = JSON.parse(e.data).message } catch { /* stream closed */ }
    if (e.data) showError(msg)
    es.close(); done()
  })
}

function showError(msg) { const el = $('err'); el.textContent = msg; el.hidden = false }
function done() {
  const btn = $('run'); btn.disabled = false
  btn.querySelector('.run-label').textContent = 'Prove again'
  btn.querySelector('.run-sub').textContent = 'new live proof'
}

$('run').addEventListener('click', run)
