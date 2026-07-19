import React from 'react'
import { createRoot } from 'react-dom/client'
import { AnonAadhaarProvider } from '@anon-aadhaar/react'
import App from './App.jsx'

// _useTestAadhaar: true accepts UIDAI's official TEST Aadhaar (for dev without a real
// card). Flip to false for production (real Aadhaar Secure QR only).
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AnonAadhaarProvider _useTestAadhaar={true}>
      <App />
    </AnonAadhaarProvider>
  </React.StrictMode>,
)
