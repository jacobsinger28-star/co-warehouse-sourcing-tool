import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import fs from 'node:fs'
import App from './src/App.jsx'
const html = renderToStaticMarkup(React.createElement(App))
fs.mkdirSync('.ssr-out', { recursive: true })
fs.writeFileSync('.ssr-out/app.html', html)
console.log('wrote app.html', html.length, 'bytes')
