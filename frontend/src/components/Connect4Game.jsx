import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'

const ROWS = 6
const COLS = 7

function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null))
}

function cloneBoard(board) {
  return board.map((row) => [...row])
}

function getDropRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (!board[r][col]) return r
  }
  return -1
}

function checkWinner(board) {
  const directions = [
    { dr: 0, dc: 1 },
    { dr: 1, dc: 0 },
    { dr: 1, dc: 1 },
    { dr: 1, dc: -1 }
  ]

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c]
      if (!cell) continue

      for (const { dr, dc } of directions) {
        let count = 1
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k
          const cc = c + dc * k
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break
          if (board[rr][cc] !== cell) break
          count++
        }
        if (count >= 4) return cell
      }
    }
  }

  return null
}

export default function Connect4Game({ lobby, user, peerState, onExit }) {
  const [board, setBoard] = useState(() => createEmptyBoard())
  const [gameStatus, setGameStatus] = useState('connecting') // connecting | playing | won | lost | draw
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [opponentConnected, setOpponentConnected] = useState(false)

  const { peer, peerId, connections, connectToPeer } = peerState || {}
  const isHost = lobby?.host_user_id == user?.id

  const connRef = useRef(null)
  const hostListenerAttachedRef = useRef(false)
  const primaryOpponentPeerRef = useRef(null)
  const gameStatusRef = useRef('connecting')
  const resultSavedRef = useRef(false)
  const guestConnectInFlightRef = useRef(false)
  const guestConnectedToRef = useRef(null)

  const members = lobby?.members || []
  const opponentMember = useMemo(() => members.find((m) => m.user_id != user?.id), [members, user?.id])
  const opponentName = opponentMember?.username || 'Opponent'
  const opponentUserId = opponentMember?.user_id

  const myDisc = isHost ? 'R' : 'Y'
  const opponentDisc = isHost ? 'Y' : 'R'


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
      console.error('[Connect4Game] Failed to leave lobby on server:', e)
    }
  }, [lobby?.id, user?.id])

  useEffect(() => {
    gameStatusRef.current = gameStatus
  }, [gameStatus])

  const broadcastFromHost = useCallback((data) => {
    const conns = Object.values(connections || {})
    for (const c of conns) {
      if (c?.open) {
        try {
          c.send(data)
        } catch (e) {
          console.error('[Connect4Game] Host failed to send:', c?.peer, e)
        }
      }
    }
  }, [connections])

  const closeGameConnections = useCallback(() => {
    try {
      connRef.current?.close?.()
      connRef.current = null

      const conns = Object.values(connections || {})
      conns.forEach((c) => {
        if (c?.open) c.close()
      })
    } catch (e) {
      // ignore
    } finally {
      setOpponentConnected(false)
    }
  }, [connections])

  useEffect(() => {
    const finished = gameStatus === 'won' || gameStatus === 'lost' || gameStatus === 'draw'
    if (!finished) return
    closeGameConnections()
  }, [gameStatus, closeGameConnections])

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

  const reportResult = useCallback(async ({ outcome }) => {
    if (!isHost) return
    if (resultSavedRef.current) return
    if (!lobby?.game_id || !user?.id || !opponentUserId) return
    if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'draw') return

    resultSavedRef.current = true

    try {
      const isDraw = outcome === 'draw'
      const winnerUserId = isDraw ? null : (outcome === 'won' ? user.id : opponentUserId)
      const loserUserId = isDraw ? null : (outcome === 'won' ? opponentUserId : user.id)

      const body = {
        game_id: lobby.game_id,
        is_draw: isDraw
      }

      if (isDraw) {
        body.player_user_ids = [user.id, opponentUserId]
      } else {
        body.winner_user_ids = [winnerUserId]
        body.loser_user_ids = [loserUserId]
      }

      const res = await fetch(`${API_BASE_URL}/api/games/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        console.error('[Connect4Game] Failed to report result:', res.status, data)
      }
    } catch (e) {
      console.error('[Connect4Game] Failed to report result:', e)
    }
  }, [isHost, lobby?.game_id, opponentUserId, user?.id])

  const finishByForfeit = useCallback((winnerIsMe) => {
    if (gameStatusRef.current !== 'playing') return
    const next = winnerIsMe ? 'won' : 'lost'
    setGameStatus(next)
    setIsMyTurn(false)
    reportResult({ outcome: next })
    if (!winnerIsMe) {
      leaveLobbyOnServer()
    }
  }, [reportResult, leaveLobbyOnServer])


  /* =====================================================================================
  // GAME-SPECIFIC LOGIC (differs per game)
  // ===================================================================================== */

  const handleData = useCallback((data) => {
    if (data?.type === 'game-ready') {
      setOpponentConnected(true)
      setGameStatus('playing')
      setIsMyTurn(!!isHost)
      return
    }

    if (data?.type === 'drop') {
      const col = Number(data.col)
      if (!Number.isFinite(col) || col < 0 || col >= COLS) return

      setBoard((prev) => {
        const b = cloneBoard(prev)
        const row = getDropRow(b, col)
        if (row === -1) return prev
        b[row][col] = data.disc

        const winner = checkWinner(b)
        if (winner) {
          const outcome = winner === myDisc ? 'won' : 'lost'
          setGameStatus(outcome)
          reportResult({ outcome })
          setIsMyTurn(false)
        } else if (b.every((r) => r.every((x) => x))) {
          setGameStatus('draw')
          reportResult({ outcome: 'draw' })
          setIsMyTurn(false)
        } else {
          setIsMyTurn(true)
        }

        return b
      })

      return
    }

    if (data?.type === 'forfeit') {
      finishByForfeit(true)
    }
  }, [finishByForfeit, isHost, myDisc, reportResult])

  const dataHandlerRef = useRef(null)
  useEffect(() => {
    dataHandlerRef.current = handleData
  }, [handleData])

  // Host: accept incoming connection
  useEffect(() => {
    if (!peer || !isHost) return

    console.log('[Connect4Game] ✅ Starting P2P connection setup (host)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobby.id}/update-peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, peer_id: peerId })
    }).catch(err => console.error('[Connect4Game] Failed to update peer_id:', err))

    const handleConnection = (conn) => {
      console.log('[Connect4Game] Host received connection from:', conn.peer)
      if (!primaryOpponentPeerRef.current) {
        primaryOpponentPeerRef.current = conn.peer
        console.log('[Connect4Game] Host primary opponent set to:', conn.peer)
      }

      conn.on('open', () => {
        console.log('[Connect4Game] ✅ Host connection OPENED')
        setOpponentConnected(true)
        setGameStatus('playing')
        setIsMyTurn(true)

        try {
          conn.send({ type: 'game-ready' })
        } catch (e) {}
        // keep all peers in sync (in case of spectators)
        broadcastFromHost({ type: 'game-ready' })
      })

      conn.on('error', (err) => console.error('[Connect4Game] Host connection error:', err))

      conn.on('data', (d) => {
        if (primaryOpponentPeerRef.current && conn.peer !== primaryOpponentPeerRef.current) return
        dataHandlerRef.current?.(d)
      })

      conn.on('close', () => {
        console.log('[Connect4Game] Host connection closed')
        if (primaryOpponentPeerRef.current === conn.peer) {
          primaryOpponentPeerRef.current = null
        }

        const anyOpen = Object.values(connections || {}).some((c) => c?.open)
        setOpponentConnected(anyOpen)
        if (!anyOpen) finishByForfeit(true)
      })
    }

    if (!hostListenerAttachedRef.current) {
      hostListenerAttachedRef.current = true
      peer.on('connection', handleConnection)
    }

    return () => {
      if (hostListenerAttachedRef.current) {
        try {
          peer.off('connection', handleConnection)
        } catch (e) {}
        hostListenerAttachedRef.current = false
      }
    }
  }, [peer, isHost, lobby?.id, peerId, user?.id, broadcastFromHost, connections, finishByForfeit])

  // Guest: connect to host
  useEffect(() => {
    if (!peer || isHost) return

    const lobbyId = lobby?.id
    if (!lobbyId) return

    if (connRef.current?.open) return
    if (guestConnectInFlightRef.current) return

    guestConnectInFlightRef.current = true

    console.log('[Connect4Game] ✅ Starting P2P connection setup (guest)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobbyId}`)
      .then((r) => r.json())
      .then((data) => {
        const hostMember = data.members?.find((m) => m.user_id === lobby.host_user_id)
        const hostPeerId = hostMember?.peer_id
        if (!hostPeerId || !peerId) return

        if (guestConnectedToRef.current === hostPeerId && connRef.current?.open) return

        console.log('[Connect4Game] Guest connecting to host:', hostPeerId)
        const conn = connectToPeer(hostPeerId)
        connRef.current = conn
        guestConnectedToRef.current = hostPeerId

        conn.on('open', () => {
          console.log('[Connect4Game] ✅ Guest connected to host')
          setOpponentConnected(true)
          try {
            conn.send({ type: 'game-ready' })
          } catch (e) {}
        })

        conn.on('error', (err) => console.error('[Connect4Game] Guest connection error:', err))

        conn.on('data', (d) => dataHandlerRef.current?.(d))
        conn.on('close', () => {
          console.log('[Connect4Game] Guest connection closed')
          setOpponentConnected(false)
          connRef.current = null
          guestConnectedToRef.current = null
          guestConnectInFlightRef.current = false
          finishByForfeit(true)
        })
      })
      .catch(err => console.error('[Connect4Game] Guest failed to get peer_id:', err))
      .finally(() => {
        guestConnectInFlightRef.current = false
      })
  }, [peer, isHost, lobby?.id, lobby?.host_user_id, peerId, connectToPeer, finishByForfeit])

  const handleDrop = (col) => {
    if (!isMyTurn || gameStatus !== 'playing') return

    const b = cloneBoard(board)
    const row = getDropRow(b, col)
    if (row === -1) return

    // lock immediately
    setIsMyTurn(false)

    b[row][col] = myDisc
    setBoard(b)

    // send exactly once
    sendGameData({ type: 'drop', col, disc: myDisc })

    const winner = checkWinner(b)
    if (winner) {
      setGameStatus('won')
      reportResult({ outcome: 'won' })
    } else if (b.every((r) => r.every((x) => x))) {
      setGameStatus('draw')
      reportResult({ outcome: 'draw' })
    }
  }

  const handleExit = () => {
    if (gameStatus === 'playing') {
      try {
        sendGameData({ type: 'forfeit' })
      } catch (e) {}
      finishByForfeit(false)
    } else {
      leaveLobbyOnServer()
    }
    onExit?.()
  }

  const statusMessage = useMemo(() => {
    if (gameStatus === 'connecting') return '🔄 Connecting...'
    if (gameStatus === 'playing') return isMyTurn ? `Your turn (${myDisc})` : `${opponentName}'s turn (${opponentDisc})`
    if (gameStatus === 'won') return '🎉 You won!'
    if (gameStatus === 'lost') return '😔 You lost!'
    if (gameStatus === 'draw') return "🤝 It's a draw!"
    return ''
  }, [gameStatus, isMyTurn, myDisc, opponentDisc, opponentName])



  
  return (
    <div className="connect4-game-container">
      <div className="game-header">
        <button className="back-btn" onClick={handleExit}>← Leave Game</button>
        <h1>Connect 4</h1>
        <div className="status-indicator">
          <span className={`indicator-dot ${opponentConnected ? 'connected' : ''}`} />
          {opponentConnected ? 'Connected' : 'Connecting...'}
        </div>
      </div>

      <div className={`game-status ${gameStatus}`}>{statusMessage}</div>

      <div className="connect4-board" role="grid" aria-label="Connect 4 board">
        {Array.from({ length: COLS }).map((_, col) => (
          <button
            key={`col-${col}`}
            className="connect4-col"
            onClick={() => handleDrop(col)}
            disabled={!isMyTurn || gameStatus !== 'playing' || getDropRow(board, col) === -1}
            aria-label={`Drop in column ${col + 1}`}
          >
            <div className="connect4-col-cells">
              {Array.from({ length: ROWS }).map((__, rowIdx) => {
                const row = rowIdx
                const cell = board[row][col]
                const cls = cell === 'R' ? 'r' : cell === 'Y' ? 'y' : ''
                return (
                  <div key={`${row}-${col}`} className={`connect4-cell ${cls}`} />
                )
              })}
            </div>
          </button>
        ))}
      </div>

      {(gameStatus === 'won' || gameStatus === 'lost' || gameStatus === 'draw') && (
        <div className="game-over-actions">
          <button className="exit-btn" onClick={handleExit}>🚪 Exit</button>
        </div>
      )}
    </div>
  )
}
