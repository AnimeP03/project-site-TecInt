import React, { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import GameGrid from './components/GameGrid'
import ProfilePage from './components/ProfilePage'
import TrisGame from './components/TrisGame'
import Connect4Game from './components/Connect4Game'
import RpsGame from './components/RpsGame'
import GuessNumberGame from './components/GuessNumberGame'
import AuthModal from './components/AuthModal'
import { usePeer } from './lib/usePeer'

export default function App() {
  const [user, setUser] = useState(null)
  const [showAuth, setShowAuth] = useState(false)
  const [currentPage, setCurrentPage] = useState('home') // 'home' | 'profile' | 'game'
  const [activeLobby, setActiveLobby] = useState(null) // Current game lobby data

  // Peer viene creato una volta che l'utente ha fatto il login
  const peerState = usePeer(user ? user.id : null)

  // Handle game start from lobby
  const handleGameStart = (lobbyData) => {
    setActiveLobby(lobbyData)
    setCurrentPage('game')
  }

  // Handle game exit
  const handleGameExit = () => {
    setActiveLobby(null)
    setCurrentPage('home')
  }

  return (
    <div className="app-root">
      {currentPage !== 'game' && <Header
        user={user}
        onLoginClick={() => setShowAuth(true)}
        onLogout={() => { setUser(null); setCurrentPage('home'); setActiveLobby(null) }}
        onHomeClick={() => { setCurrentPage('home'); setActiveLobby(null) }}
        onProfileClick={() => setCurrentPage('profile')}
        hideNav={currentPage === 'game'}
      />}
      <main className="main-content">
        {currentPage === 'home' && (
          <GameGrid 
            user={user} 
            onLoginClick={() => setShowAuth(true)} 
            peerState={peerState}
            onGameStart={handleGameStart}
          />
        )}
        {currentPage === 'profile' && user && (
          <ProfilePage 
            user={user} 
            onBack={() => setCurrentPage('home')} 
          />
        )}
        {currentPage === 'game' && activeLobby && (
          (() => {
            const name = String(activeLobby?.game_name || '').toLowerCase()
            const commonProps = {
              lobby: activeLobby,
              user,
              peerState,
              onExit: handleGameExit
            }

            if (name.includes('tris') || name.includes('tic')) {
              return <TrisGame {...commonProps} />
            }

            if (name.includes('connect')) {
              return <Connect4Game {...commonProps} />
            }

            if (name.includes('sasso') || name.includes('rock') || name.includes('paper') || name.includes('scissors')) {
              return <RpsGame {...commonProps} />
            }

            if (name.includes('indovina') || name.includes('guess')) {
              return <GuessNumberGame {...commonProps} />
            }

            return (
              <div className="container">
                <div className="game-status connecting">Unsupported game: {activeLobby?.game_name}</div>
                <button className="exit-btn" onClick={handleGameExit}>← Back</button>
              </div>
            )
          })()
        )}
      </main>
      {currentPage !== 'game' && <Footer />}

      <AuthModal
        open={showAuth}
        onClose={() => setShowAuth(false)}
        onAuth={(u) => {
          setUser(u)
          setShowAuth(false)
        }}
      />
    </div>
  )
}
