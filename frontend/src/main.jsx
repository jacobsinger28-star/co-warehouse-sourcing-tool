import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import Gate from './Gate.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Gate>
      <App />
    </Gate>
  </React.StrictMode>,
)
