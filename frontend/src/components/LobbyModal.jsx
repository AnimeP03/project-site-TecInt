import React, { useEffect, useState, useCallback } from 'react'
import { API_BASE_URL } from '../config'

export default function LobbyModal({ open, onClose, game, user, peerState, onGameStart }) {
  const [lobbies, setLobbies] = useState([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [maxPlayers, setMaxPlayers] = useState(game?.max_players || 2)
  const [expandedLobby, setExpandedLobby] = useState(null)
  const [members, setMembers] = useState([])
  const [tab, setTab] = useState('lobby')
  const [isPrivate, setIsPrivate] = useState(false)
  const [lobbyPassword, setLobbyPassword] = useState('')
  const [joinPassword, setJoinPassword] = useState('')
  const [passwordPromptLobby, setPasswordPromptLobby] = useState(null)
  
  // Lobby Room State
  const [currentLobby, setCurrentLobby] = useState(null)
  const [lobbyMembers, setLobbyMembers] = useState([])
  const [isReady, setIsReady] = useState(false)

  const { peerId, connections, connectToPeer, ready } = peerState || {}

  // Keep maxPlayers in sync with the currently selected game.
  // UI should show options from 2 up to game.max_players.
  useEffect(() => {
    const max = Number(game?.max_players) || 2
    const clampedMax = Math.max(2, max)
    setMaxPlayers((prev) => {
      const prevNum = Number(prev) || 2
      if (prevNum < 2) return 2
      if (prevNum > clampedMax) return clampedMax
      return prevNum
    })
  }, [game?.id, game?.max_players])

  // Fetch lobby room details
  const fetchLobbyDetails = useCallback(async (lobbyId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/lobbies/${lobbyId}`)
      const data = await res.json()
      if (res.ok) {
        // Check if game has started (status changed to 'playing')
        if (data.lobby.status === 'Playing') {
          // Clear lobby state before transitioning
          setCurrentLobby(null)
          setLobbyMembers([])
          setIsReady(false)
          // Transition to game
          const lobbyData = {
            ...data.lobby,
            game_name: game?.name,
            members: data.members
          }
          onGameStart?.(lobbyData)
          return
        }
        
        setCurrentLobby(data.lobby)
        setLobbyMembers(data.members || [])
        // Find current user's ready status
        const me = data.members?.find(m => m.user_id === user?.id)
        setIsReady(me?.is_ready === 1)
      } else if (res.status === 404) {
        // Lobby was deleted (host left) - kick everyone out
        setCurrentLobby(null)
        setLobbyMembers([])
        setIsReady(false)
        setExpandedLobby(false)
        setPasswordPromptLobby(false)
      }
    } catch (err) {
      console.error(err)
    }
  }, [user, game, onGameStart])

  // Poll lobby room for updates
  useEffect(() => {
    if (!currentLobby) {
      return
    }
    
    const lobbyId = currentLobby.id
    
    // Immediate fetch
    fetchLobbyDetails(lobbyId)
    
    const interval = setInterval(() => {
      fetchLobbyDetails(lobbyId)
    }, 1000)
    
    return () => {
      clearInterval(interval)
    }
  }, [currentLobby?.id, fetchLobbyDetails]) // Include fetchLobbyDetails in dependencies


  //caricare le lobby per il gioco selezionato in lobbies
  useEffect(() => {
    if (!open || !game) return

    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const endpoint = `${API_BASE_URL}/api/lobbies?game_id=` + game.id 
        const res = await fetch(endpoint)
        const data = await res.json()
        if (mounted) setLobbies(data.lobbies || [])
      } catch (err) {
        console.error(err)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, 5000) // Auto refresh every 5s
    return () => { mounted = false; clearInterval(interval) }
  }, [open, game])


  //se non e aperto , non renderizzare nulla
  if (!open) return null

  //creare una nuova lobby
  async function createLobby() {

    if (!user || !peerId) return onClose()
    
    if (isPrivate && !lobbyPassword) {
      alert('Please enter a password for private lobby')
      return
    }

    setCreating(true)
    try {
      const endpoint = `${API_BASE_URL}/api/lobbies/createlobby`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          game_id: game.id, 
          host_user_id: user.id, 
          max_players: Number(maxPlayers),
          peer_id: peerId,
          is_private: isPrivate,
          password: isPrivate ? lobbyPassword : null
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to create lobby')

      // Enter lobby room view
      setLobbyPassword('')
      setIsPrivate(false)
      fetchLobbyDetails(data.lobby.id)

    } catch (err) {
      console.error(err)
      alert(err.message)
    } finally {
      setCreating(false)
    }
  }

  //join la lobby
  async function joinLobby(id, password = null) {

    if (!user || !peerId) return onClose()

    try {
      const endpoint = `${API_BASE_URL}/api/lobbies/${id}/join`
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          user_id: user.id,
          peer_id: peerId,
          password: password
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Join Failed')
      
      // Enter lobby room view
      setPasswordPromptLobby(null)
      setJoinPassword('')
      fetchLobbyDetails(id)

    } catch (err) {
      console.error(err)
      alert(err.message)
    }
  }

  // Toggle ready status
  async function toggleReady() {
    if (!currentLobby || !user) return
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/lobbies/${currentLobby.id}/ready`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, peer_id: peerId }) // Include current peer_id
      })
      const data = await res.json()
      if (res.ok) {
        setIsReady(data.is_ready)
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Start game (host only)
  async function startGame() {
    if (!currentLobby || !user) return
    
    try {
      const res = await fetch(`${API_BASE_URL}/api/lobbies/${currentLobby.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to start')
      
      console.log('[LobbyModal] Host starting game with members:', lobbyMembers)
      
      // Clear lobby state
      const lobbyData = {
        ...currentLobby,
        game_name: game?.name,
        members: lobbyMembers
      }
      setCurrentLobby(null)
      setLobbyMembers([])
      setIsReady(false)
      
      // Game started - pass lobby data to game
      onGameStart?.(lobbyData)

    } catch (err) {
      console.error(err)
      alert(err.message)
    }
  }

  // Leave lobby
  async function leaveLobby() {
    if (!currentLobby || !user) return
    
    try {
      await fetch(`${API_BASE_URL}/api/lobbies/${currentLobby.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id })
      })
      setCurrentLobby(null)
      setLobbyMembers([])
      setIsReady(false)
    } catch (err) {
      console.error(err)
    }
  }

  // Handle join click - check if private
  function handleJoinClick(lobby) {
    if (lobby.is_private) {
      setPasswordPromptLobby(lobby.id)
    } else {
      joinLobby(lobby.id)
    }
  }

  const isHost = currentLobby && user && currentLobby.host_user_id === user.id
  const allReady = lobbyMembers.length > 0 && lobbyMembers.every(m => m.is_ready === 1)
  const canStart = isHost && allReady && lobbyMembers.length >= 2

  // LOBBY ROOM VIEW
  if (currentLobby) {
    return (
      <div className="lobby-modal-overlay" role="dialog" aria-modal="true">
        <div className="lobby-backdrop" onClick={() => {}} />
        <div className="lobby-room-container">
          <div className="lobby-room-header">
            <div className="lobby-room-title">
              <span className="lobby-room-game">{currentLobby.game_name || game?.name}</span>
              <span className="lobby-room-id">Lobby #{currentLobby.id}</span>
              {currentLobby.is_private === 1 && <span className="status-badge private">🔒 Private</span>}
            </div>
            <button className="leave-btn" onClick={leaveLobby}>
              {isHost ? '🗑️ Close Lobby' : '🚪 Leave'}
            </button>
          </div>

          <div className="lobby-room-players">
            <div className="players-header">
              <span>Players ({lobbyMembers.length}/{currentLobby.max_players})</span>
            </div>
            <div className="players-list">
              {lobbyMembers.map((m, idx) => (
                <div key={m.id} className={`player-card ${m.is_ready ? 'ready' : 'not-ready'}`}>
                  <div className="player-avatar">
                    {m.user_id === currentLobby.host_user_id ? '👑' : '👤'}
                  </div>
                  <div className="player-info">
                    <span className="player-name">{m.username}</span>
                    {m.user_id === currentLobby.host_user_id && <span className="host-badge">Host</span>}
                  </div>
                  <div className={`ready-status ${m.is_ready ? 'ready' : ''}`}>
                    {m.is_ready ? '✓ Ready' : '○ Not Ready'}
                  </div>
                </div>
              ))}
              
              {/* Empty slots */}
              {Array.from({ length: currentLobby.max_players - lobbyMembers.length }).map((_, i) => (
                <div key={`empty-${i}`} className="player-card empty">
                  <div className="player-avatar">⏳</div>
                  <div className="player-info">
                    <span className="player-name">Waiting for player...</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lobby-room-actions">
            {!isHost && (
              <button 
                className={`ready-btn ${isReady ? 'is-ready' : ''}`} 
                onClick={toggleReady}
              >
                {isReady ? '✓ Ready!' : '○ Click when Ready'}
              </button>
            )}
            
            {isHost && (
              <button 
                className={`start-game-btn ${canStart ? '' : 'disabled'}`}
                onClick={startGame}
                disabled={!canStart}
              >
                {lobbyMembers.length < 2 
                  ? '⏳ Waiting for players...' 
                  : !allReady 
                    ? '⏳ Waiting for ready...' 
                    : '🎮 Start Game'}
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="lobby-modal-overlay" role="dialog" aria-modal="true">
      <div className="lobby-backdrop" onClick={onClose} />
      <div className="lobby-container">
        {/* Left Panel - Lobby List */}
        <div className="lobby-left-panel">
          <div className="lobby-header">
            <h2>{game?.name || 'Select Game'}</h2>
            <div className="lobby-tabs">
              <button className={`lobby-tab ${tab === 'lobby' ? 'active' : ''}`} onClick={() => setTab('lobby')}>
                Lobby
              </button>
            </div>
          </div>

          <div className="lobby-table-header">
            <span className="col-player">Player</span>
            <span className="col-players">Players</span>
            <span className="col-status">Status</span>
          </div>

          <div className="lobby-list">
            {loading && lobbies.length === 0 ? (
              <div className="lobby-empty">Loading...</div>
            ) : lobbies.length === 0 ? (
              <div className="lobby-empty">No open lobbies. Create one!</div>
            ) : (
              lobbies.map(l => (
                <div key={l.id}>
                  <div 
                    className={`lobby-row ${expandedLobby === l.id ? 'expanded' : ''}`}
                    onClick={() => {
                      if (expandedLobby === l.id) {
                        setExpandedLobby(null)
                        setMembers([])
                      } else {
                        fetch(`${API_BASE_URL}/api/lobbies/${l.id}/members`)
                          .then(r => r.json())
                          .then(d => { setMembers(d.members || []); setExpandedLobby(l.id) })
                      }
                    }}
                  >
                    <span className="col-player">
                      <span className="player-icon">👤</span>
                      <span className="player-name">{l.host_username}</span>
                    </span>
                    <span className="col-players">{l.members_count}/{l.max_players}</span>
                    <span className="col-status">
                      {l.is_private ? <span className="status-badge private">🔒 Private</span> : <span className="status-badge open">{l.status}</span>}
                    </span>
                    <button className="join-btn" onClick={(e) => { e.stopPropagation(); handleJoinClick(l) }}>Join</button>
                  </div>
                  
                  {/* Password prompt inline under this lobby */}
                  {passwordPromptLobby === l.id && (
                    <div className="lobby-password-prompt-inline">
                      <input 
                        type="password"
                        className="lobby-password-input"
                        placeholder="Enter password..."
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && joinLobby(l.id, joinPassword)}
                        autoFocus
                      />
                      <button className="join-btn" onClick={() => joinLobby(l.id, joinPassword)}>Join</button>
                      <button className="cancel-btn" onClick={() => { setPasswordPromptLobby(null); setJoinPassword('') }}>✕</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Expanded member details */}
          {expandedLobby && (
            <div className="lobby-members-panel">
              <div className="members-header">Members in Lobby #{expandedLobby}</div>
              {members.map(m => (
                <div key={m.id} className="member-row">
                  <span>👤 {m.username}</span>
                  {/*<span className="member-email">{m.email}</span>*/}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Panel - Create Game */}
        <div className="lobby-right-panel">
          <button className="close-modal" onClick={onClose} aria-label="Close">×</button>
          
          <h2>Create Game</h2>
          
          <div className="create-section">
            <label className="create-label">Max Players</label>
            <div className="player-select">
              {Array.from(
                { length: Math.max(1, (Number(game?.max_players) || 2) - 1) },
                (_, i) => i + 2
              ).map(n => (
                <button 
                  key={n}
                  className={`player-option ${maxPlayers == n ? 'selected' : ''}`}
                  onClick={() => setMaxPlayers(n)}
                >
                  {n} Players
                </button>
              ))}
            </div>
          </div>

          <div className="create-section">
            <label className="create-label">Visibility</label>
            <div className="player-select">
              <button 
                className={`player-option ${!isPrivate ? 'selected' : ''}`}
                onClick={() => { setIsPrivate(false); setLobbyPassword('') }}
              >
                🌐 Public
              </button>
              <button 
                className={`player-option ${isPrivate ? 'selected' : ''}`}
                onClick={() => setIsPrivate(true)}
              >
                🔒 Private
              </button>
            </div>
          </div>

          {isPrivate && (
            <div className="create-section">
              <label className="create-label">Lobby Password</label>
              <input 
                type="password"
                className="lobby-password-input"
                placeholder="Enter password..."
                value={lobbyPassword}
                onChange={(e) => setLobbyPassword(e.target.value)}
              />
            </div>
          )}

          <button 
            className="create-game-btn" 
            onClick={createLobby} 
            disabled={creating || !ready}
          >
            {creating ? '⏳ Creating...' : ready ? `🎮 Create a game` : '⏳ Connecting...'}
          </button>

        </div>
      </div>
    </div>
  )
}
