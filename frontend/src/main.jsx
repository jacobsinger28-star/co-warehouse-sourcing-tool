import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Gate from './Gate.jsx'
import DemoGate from './DemoGate.jsx'
import { DEMO } from './demo.js'
import './index.css'

// /demo (or ?demo=1) → public, login-free showcase on synthetic data.
// Everything else → the normal auth Gate over real data.
createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {DEMO
      ? <DemoGate><App /></DemoGate>
      : <Gate><App /></Gate>}
  </React.StrictMode>,
)
