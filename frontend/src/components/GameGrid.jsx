import React, { useEffect, useState } from 'react'
import LobbyModal from './LobbyModal'
import { API_BASE_URL } from '../config'

export default function GameGrid({ user, onLoginClick, peerState, onGameStart }) {
  const [games, setGames] = useState(null)
  const [loading, setLoading] = useState(false)
  const [activeGame, setActiveGame] = useState(null)

  useEffect(() => {
    //se gia montato i giochi , evita di farlo ogni volta
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const endpoint = `${API_BASE_URL}/api/games/games` 
        const res = await fetch(endpoint)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')
        if (mounted) setGames(data.games)
      } catch (err) {
        console.error('Failed to fetch games', err)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  if (loading && !games) return <div className="container">Loading games…</div>
  if (!games || games.length === 0) return <div className="container">No games available</div>

  return (
    <>
    <section className="game-grid container">
      {games.map((g) => {
        const icon = g.icon || '🎲'
        return (
          <article key={g.id} className="game-card">
            <div className="game-icon" aria-hidden>
              <span>{icon}</span>
            </div>
            <div className="game-title">{g.name}</div>
            {user ? (
              <button className="btn-play" onClick={()=>setActiveGame(g)}>Gioca</button>
            ) : (
              <button className="btn-play login" onClick={onLoginClick}>Login to play</button>
            )}
          </article>
        )
      })}
    </section>
    <LobbyModal 
      open={!!activeGame} 
      onClose={()=>setActiveGame(null)} 
      game={activeGame}
      user={user} 
      peerState={peerState} 
      onGameStart={(lobbyData) => { 
        console.log('[GameGrid] Game starting with lobby:', lobbyData)
        setActiveGame(null)
        onGameStart?.(lobbyData)
      }}
    />
    </>
  )
}
