import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

export default function GuessNumberGame({ lobby, user, peerState, onExit }) {
  const [gameStatus, setGameStatus] = useState('connecting') // connecting | playing | ended
  const [opponentConnected, setOpponentConnected] = useState(false)
  const [myInput, setMyInput] = useState('')
  const [myHint, setMyHint] = useState('')
  const [winnerUserId, setWinnerUserId] = useState(null)
  const [log, setLog] = useState([]) // {user_id, number, hint}

  const [turnOrder, setTurnOrder] = useState([]) // user_ids in order
  const [currentTurnUserId, setCurrentTurnUserId] = useState(null)

  const { peer, peerId, connections, connectToPeer } = peerState || {}
  const isHost = lobby?.host_user_id == user?.id

  const members = lobby?.members || []
  const expectedPlayers = members.length

  const connRef = useRef(null)
  const hostListenerAttachedRef = useRef(false)
  const guestConnectInFlightRef = useRef(false)
  const guestConnectedToRef = useRef(null)

  const connectedPeersRef = useRef(new Set())
  const peerToUserIdRef = useRef(new Map())

  // Keep a direct list of accepted host connections for reliable broadcasting.
  const hostConnectionsRef = useRef(new Map())

  const gameStatusRef = useRef('connecting')

  const turnOrderRef = useRef([])
  const currentTurnUserIdRef = useRef(null)

  const secretRef = useRef(null)
  const resultSavedRef = useRef(false)

  useEffect(() => {
    gameStatusRef.current = gameStatus
  }, [gameStatus])

  useEffect(() => {
    turnOrderRef.current = turnOrder
  }, [turnOrder])

  useEffect(() => {
    currentTurnUserIdRef.current = currentTurnUserId
  }, [currentTurnUserId])


  /* =====================================================================================
  // SHARED HELPERS (same idea in all games)
  // ===================================================================================== */

  /*
  //
  //funzione per lasciare la lobby
  //
  */
  const leaveLobbyOnServer = useCallback(async () => {
    if (!lobby?.id || !user?.id) return
    try {
      await fetch(`${API_BASE_URL}/api/lobbies/${lobby.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id })
      })
    } catch (e) {
      console.error('[GuessNumberGame] Failed to leave lobby on server:', e)
    }
  }, [lobby?.id, user?.id])

  const broadcastFromHost = useCallback((data) => {
    const merged = new Map()

    for (const c of Object.values(connections || {})) {
      if (c?.peer) merged.set(c.peer, c)
    }

    for (const c of hostConnectionsRef.current.values()) {
      if (c?.peer) merged.set(c.peer, c)
    }

    for (const c of merged.values()) {
      if (!c?.open) continue
      try {
        c.send(data)
      } catch (e) {
        console.error('[GuessNumberGame] Host failed to send:', c?.peer, e)
      }
    }
  }, [connections])

  const sendGameData = useCallback((data) => {
    if (isHost) {
      broadcastFromHost(data)
      return
    }

    if (connRef.current?.open) {
      connRef.current.send(data)
      return
    }

    const fallback = Object.values(connections || {}).find((c) => c?.open)
    if (fallback) fallback.send(data)
  }, [isHost, broadcastFromHost, connections])

  const reportResult = useCallback(async ({ winners, losers, isDraw }) => {
    // only host reports to avoid double counting
    if (!isHost) return
    if (resultSavedRef.current) return
    if (!lobby?.game_id) return

    resultSavedRef.current = true

    try {
      const body = {
        game_id: lobby.game_id,
        is_draw: !!isDraw
      }

      if (isDraw) {
        body.player_user_ids = members.map((m) => m.user_id)
      } else {
        body.winner_user_ids = winners
        body.loser_user_ids = losers
      }

      const res = await fetch(`${API_BASE_URL}/api/games/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        console.error('[GuessNumberGame] Failed to report result:', res.status, data)
      }
    } catch (e) {
      console.error('[GuessNumberGame] Failed to report result:', e)
    }
  }, [isHost, lobby?.game_id, members])

  const closeGameConnections = useCallback(() => {
    try {
      connRef.current?.close?.()
      connRef.current = null
      const conns = Object.values(connections || {})
      conns.forEach((c) => {
        if (c?.open) c.close()
      })

      const hostConns = Array.from(hostConnectionsRef.current.values())
      hostConns.forEach((c) => {
        if (c?.open) c.close()
      })
      hostConnectionsRef.current.clear()
    } catch (e) {
      // ignore
    }
  }, [connections])

  useEffect(() => {
    if (gameStatus !== 'ended') return
    closeGameConnections()
  }, [gameStatus, closeGameConnections])


  /* =====================================================================================
  // GAME-SPECIFIC LOGIC (differs per game)
  // ===================================================================================== */

  const initTurnOrder = useCallback(() => {
    if (!isHost) return
    if (!members?.length) return

    const hostId = Number(user?.id)
    const ordered = [...members]
      .slice()
      .sort((a, b) => {
        const ta = a?.joined_at ? new Date(a.joined_at).getTime() : 0
        const tb = b?.joined_at ? new Date(b.joined_at).getTime() : 0
        if (ta !== tb) return ta - tb
        return Number(a.user_id) - Number(b.user_id)
      })
      .map((m) => Number(m.user_id))
      .filter((id) => Number.isFinite(id))

    const uniq = Array.from(new Set(ordered))
    if (Number.isFinite(hostId) && !uniq.includes(hostId)) {
      uniq.unshift(hostId)
    }

    if (!uniq.length) return

    // keep existing order if already set (avoid resets mid-game)
    if (turnOrderRef.current?.length) return

    const first = uniq[0]
    setTurnOrder(uniq)
    setCurrentTurnUserId(first)

    // Update refs immediately to avoid rejecting early guesses before React re-renders.
    turnOrderRef.current = uniq
    currentTurnUserIdRef.current = first

    broadcastFromHost({ type: 'turn', order: uniq, current_user_id: first })
  }, [isHost, members, user?.id, broadcastFromHost])

  const advanceTurnFrom = useCallback((fromUserId) => {
    if (!isHost) return
    const order = turnOrderRef.current || []
    if (!order.length) return

    const from = Number(fromUserId)
    const idx = order.findIndex((id) => Number(id) === from)
    const nextIdx = idx >= 0 ? (idx + 1) % order.length : 0
    const next = order[nextIdx]

    setCurrentTurnUserId(next)
    currentTurnUserIdRef.current = next
    broadcastFromHost({ type: 'turn', order, current_user_id: next })
  }, [isHost, broadcastFromHost])

  const handleHostGuess = useCallback((fromUserId, number) => {
    if (gameStatusRef.current !== 'playing') return
    if (!Number.isFinite(number)) return

    // Turn-based: ignore guesses not from current player
    if (Number(fromUserId) !== Number(currentTurnUserIdRef.current)) return

    const secret = secretRef.current
    if (!Number.isFinite(secret)) return

    let hint = ''
    if (number === secret) hint = 'correct'
    else if (number < secret) hint = 'low'
    else hint = 'high'

    const msg = { type: 'guess-result', user_id: fromUserId, number, hint }

    setLog((prev) => [...prev, { user_id: fromUserId, number, hint }])
    broadcastFromHost(msg)

    if (Number(fromUserId) === Number(user?.id)) {
      setMyHint(hint === 'low' ? 'Too low' : hint === 'high' ? 'Too high' : 'Correct!')
    }

    if (hint === 'correct') {
      setWinnerUserId(fromUserId)
      setGameStatus('ended')
      gameStatusRef.current = 'ended'
      broadcastFromHost({ type: 'game-over', winner_user_id: fromUserId })

      const all = members.map((m) => m.user_id)
      const winners = [fromUserId]
      const losers = all.filter((id) => id !== fromUserId)
      reportResult({ winners, losers, isDraw: false })
      return
    }

    // wrong guess -> next player's turn
    advanceTurnFrom(fromUserId)
  }, [advanceTurnFrom, broadcastFromHost, members, reportResult, user?.id])

  const handleData = useCallback((connPeerId, data) => {
    if (data?.type === 'game-ready') {
      setOpponentConnected(true)
      setGameStatus('playing')
      gameStatusRef.current = 'playing'
      return
    }

    if (data?.type === 'player-info' && isHost) {
      const uid = Number(data.user_id)
      if (Number.isFinite(uid)) peerToUserIdRef.current.set(connPeerId, uid)
      return
    }

    if (data?.type === 'guess') {
      const num = Number(data.number)
      const declaredUid = Number(data.user_id)
      const fallbackUid = members.find((m) => m.peer_id === connPeerId)?.user_id
      const uid = isHost
        ? (peerToUserIdRef.current.get(connPeerId) ?? (Number.isFinite(declaredUid) ? declaredUid : undefined) ?? fallbackUid)
        : declaredUid

      if (!Number.isFinite(uid)) return
      handleHostGuess(uid, num)
      return
    }

    if (data?.type === 'turn') {
      const order = Array.isArray(data.order) ? data.order.map((x) => Number(x)).filter((x) => Number.isFinite(x)) : []
      const current = Number(data.current_user_id)
      if (order.length) {
        setTurnOrder(order)
        turnOrderRef.current = order
      }
      if (Number.isFinite(current)) {
        setCurrentTurnUserId(current)
        currentTurnUserIdRef.current = current
      }
      return
    }

    if (data?.type === 'guess-result') {
      const uid = Number(data.user_id)
      const number = Number(data.number)
      const hint = String(data.hint || '')
      setLog((prev) => [...prev, { user_id: uid, number, hint }])
      if (Number(uid) === Number(user.id)) {
        setMyHint(hint === 'low' ? 'Too low' : hint === 'high' ? 'Too high' : 'Correct!')
      }
      return
    }

    if (data?.type === 'game-over') {
      setWinnerUserId(Number(data.winner_user_id))
      setGameStatus('ended')
      return
    }
  }, [handleHostGuess, isHost, user?.id])

  // Host networking
  useEffect(() => {
    if (!peer || !isHost) return

    // After end, do not accept/re-establish gameplay connections.
    if (gameStatus === 'ended') {
      setOpponentConnected(false)
      return
    }

    console.log('[GuessNumberGame] ✅ Starting P2P connection setup (host)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobby.id}/update-peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, peer_id: peerId })
    }).catch(err => console.error('[GuessNumberGame] Failed to update peer_id:', err))

    if (!Number.isFinite(secretRef.current)) {
      secretRef.current = randInt(1, 100)
    }

    const maybeReady = () => {
      const connectedGuests = connectedPeersRef.current.size
      const needGuests = Math.max(0, expectedPlayers - 1)
      const ready = connectedGuests >= needGuests
      if (ready) {
        setOpponentConnected(true)
        setGameStatus('playing')
        gameStatusRef.current = 'playing'
        broadcastFromHost({ type: 'game-ready' })
        initTurnOrder()
      }
    }

    const handleConnection = (conn) => {
      console.log('[GuessNumberGame] Host received connection from:', conn.peer)
      conn.on('open', () => {
        console.log('[GuessNumberGame] ✅ Host connection OPENED')

        // If the game already ended, close immediately (prevents reconnect loops).
        if (gameStatusRef.current === 'ended') {
          try {
            conn.close()
          } catch (e) {}
          return
        }

        connectedPeersRef.current.add(conn.peer)
        hostConnectionsRef.current.set(conn.peer, conn)
        maybeReady()
        try {
          conn.send({ type: 'game-ready' })
        } catch (e) {}

        // Send current turn state to late joiners
        const order = turnOrderRef.current
        const current = currentTurnUserIdRef.current
        if (Array.isArray(order) && order.length && Number.isFinite(Number(current))) {
          try {
            conn.send({ type: 'turn', order, current_user_id: current })
          } catch (e) {}
        }
      })

      conn.on('error', (err) => console.error('[GuessNumberGame] Host connection error:', err))

      conn.on('data', (d) => handleData(conn.peer, d))

      conn.on('close', () => {
        console.log('[GuessNumberGame] Host connection closed')
        connectedPeersRef.current.delete(conn.peer)
        peerToUserIdRef.current.delete(conn.peer)
        hostConnectionsRef.current.delete(conn.peer)
      })
    }

    if (!hostListenerAttachedRef.current) {
      hostListenerAttachedRef.current = true
      peer.on('connection', handleConnection)
    }

    if (expectedPlayers <= 1) {
      setGameStatus('playing')
      gameStatusRef.current = 'playing'
      initTurnOrder()
    }

    return () => {
      if (hostListenerAttachedRef.current) {
        try {
          peer.off('connection', handleConnection)
        } catch (e) {}
        hostListenerAttachedRef.current = false
      }
    }
  }, [peer, isHost, gameStatus, lobby?.id, peerId, user?.id, expectedPlayers, broadcastFromHost, handleData, initTurnOrder])

  // Guest networking
  useEffect(() => {
    if (!peer || isHost) return

    // After end, do not reconnect.
    if (gameStatus === 'ended') return

    const lobbyId = lobby?.id
    if (!lobbyId) return

    if (connRef.current?.open) return
    if (guestConnectInFlightRef.current) return

    guestConnectInFlightRef.current = true

    console.log('[GuessNumberGame] ✅ Starting P2P connection setup (guest)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobbyId}`)
      .then((r) => r.json())
      .then((data) => {
        const hostMember = data.members?.find((m) => m.user_id === lobby.host_user_id)
        const hostPeerId = hostMember?.peer_id
        if (!hostPeerId || !peerId) return

        if (guestConnectedToRef.current === hostPeerId && connRef.current?.open) return

        console.log('[GuessNumberGame] Guest connecting to host:', hostPeerId)
        const conn = connectToPeer(hostPeerId)
        connRef.current = conn
        guestConnectedToRef.current = hostPeerId

        conn.on('open', () => {
          console.log('[GuessNumberGame] ✅ Guest connected to host')
          setOpponentConnected(true)

          // If game ended while connecting, close immediately.
          if (gameStatusRef.current === 'ended') {
            try {
              conn.close()
            } catch (e) {}
            return
          }

          try {
            conn.send({ type: 'player-info', user_id: user.id, username: user.username })
          } catch (e) {}
        })

        conn.on('error', (err) => console.error('[GuessNumberGame] Guest connection error:', err))

        conn.on('data', (d) => handleData(hostPeerId, d))
        conn.on('close', () => {
          console.log('[GuessNumberGame] Guest connection closed')
          setOpponentConnected(false)
          connRef.current = null
          guestConnectedToRef.current = null
          guestConnectInFlightRef.current = false
          setGameStatus('ended')
        })
      })
      .catch(err => console.error('[GuessNumberGame] Guest failed to get peer_id:', err))
      .finally(() => {
        guestConnectInFlightRef.current = false
      })
  }, [peer, isHost, lobby?.id, lobby?.host_user_id, peerId, connectToPeer, user?.id, user?.username, handleData])

  const submitGuess = () => {
    if (gameStatus !== 'playing') return

    const isMyTurn = Number(currentTurnUserId) === Number(user.id)
    if (!isMyTurn) {
      setMyHint('Not your turn')
      return
    }

    const n = Number(myInput)
    if (!Number.isFinite(n) || n < 1 || n > 100) return

    setMyInput('')

    if (isHost) {
      handleHostGuess(Number(user.id), n)
      return
    }

    sendGameData({ type: 'guess', user_id: user.id, number: n })
  }

  const winnerName = useMemo(() => {
    if (!winnerUserId) return ''
    if (Number(winnerUserId) === Number(user.id)) return 'You'
    return members.find((m) => Number(m.user_id) === Number(winnerUserId))?.username || 'Player'
  }, [winnerUserId, user?.id, members])

  const currentTurnName = useMemo(() => {
    if (!Number.isFinite(Number(currentTurnUserId))) return ''
    if (Number(currentTurnUserId) === Number(user.id)) return 'You'
    return members.find((m) => Number(m.user_id) === Number(currentTurnUserId))?.username || 'Player'
  }, [currentTurnUserId, user?.id, members])

  const isMyTurn = useMemo(() => {
    return gameStatus === 'playing' && Number(currentTurnUserId) === Number(user.id)
  }, [gameStatus, currentTurnUserId, user?.id])

  const handleExit = () => {
    // Close P2P then leave lobby in DB.
    closeGameConnections()
    leaveLobbyOnServer()
    onExit?.()
  }

  return (
    <div className="guess-game-container">
      <div className="game-header">
        <button className="back-btn" onClick={handleExit}>← Leave Game</button>
        <h1>Indovina il numero</h1>
        <div className="status-indicator">
          <span className={`indicator-dot ${opponentConnected ? 'connected' : ''}`} />
          {opponentConnected ? 'Connected' : 'Connecting...'}
        </div>
      </div>

      <div className={`game-status ${gameStatus}`}>
        {gameStatus === 'connecting'
          ? '🔄 Connecting...'
          : gameStatus === 'playing'
            ? `Turn: ${currentTurnName || '...'} - Guess a number (1-100)`
            : winnerUserId
              ? `🏆 Winner: ${winnerName}`
              : 'Game ended'}
      </div>

      {gameStatus === 'playing' && (
        <div className="guess-actions">
          <div className="guess-row">
            <input
              className="guess-input"
              value={myInput}
              onChange={(e) => setMyInput(e.target.value)}
              placeholder="1-100"
              inputMode="numeric"
              disabled={!isMyTurn}
            />
            <button className="btn-play" onClick={submitGuess} disabled={!isMyTurn}>Try</button>
          </div>
          {myHint && <div className="guess-hint">{myHint}</div>}
        </div>
      )}

      <div className="guess-log">
        {log.slice(-10).reverse().map((x, idx) => {
          const name = Number(x.user_id) === Number(user.id) ? 'You' : members.find((m) => Number(m.user_id) === Number(x.user_id))?.username || 'Player'
          const hintText = x.hint === 'low' ? 'too low' : x.hint === 'high' ? 'too high' : 'correct'
          return (
            <div key={`${idx}-${x.user_id}-${x.number}`} className="guess-log-row">
              <span className="name">{name}</span>
              <span className="guess">{x.number}</span>
              <span className="hint">{hintText}</span>
            </div>
          )
        })}
      </div>

      {gameStatus === 'ended' && (
        <div className="game-over-actions">
          <button className="exit-btn" onClick={handleExit}>🚪 Exit</button>
        </div>
      )}
    </div>
  )
}
