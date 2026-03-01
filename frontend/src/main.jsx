import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import './styles/games/shared.css'
import './styles/games/tris.css'
import './styles/games/connect4.css'
import './styles/games/rps.css'
import './styles/games/guess-number.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
