import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE_URL } from '../config'

const CHOICES = ['rock', 'paper', 'scissors']

function beats(a, b) {
  if (a === 'rock' && b === 'scissors') return true
  if (a === 'scissors' && b === 'paper') return true
  if (a === 'paper' && b === 'rock') return true
  return false
}

function computeWinners(choicesByUserId) {
  const choices = Object.values(choicesByUserId)
  const unique = Array.from(new Set(choices))

  // everyone picked same OR all three present => draw
  if (unique.length === 1 || unique.length === 3) {
    return { isDraw: true, winnerUserIds: [] }
  }

  // exactly two choices: one wins
  const [c1, c2] = unique
  const winningChoice = beats(c1, c2) ? c1 : beats(c2, c1) ? c2 : null
  if (!winningChoice) return { isDraw: true, winnerUserIds: [] }

  const winnerUserIds = Object.entries(choicesByUserId)
    .filter(([, c]) => c === winningChoice)
    .map(([uid]) => Number(uid))

  return { isDraw: false, winnerUserIds }
}

export default function RpsGame({ lobby, user, peerState, onExit }) {
  const [gameStatus, setGameStatus] = useState('connecting') // connecting | playing | revealed | match-over
  const [opponentConnected, setOpponentConnected] = useState(false)
  const [myChoice, setMyChoice] = useState(null)
  const [choicesByUserId, setChoicesByUserId] = useState({})
  const [result, setResult] = useState(null) // { is_draw, winner_user_ids, round, scores_by_user_id, match_over, match_is_draw, match_winner_user_ids }
  const [round, setRound] = useState(1) // 1..3
  const [scoresByUserId, setScoresByUserId] = useState({})

  // Refs to avoid stale closures causing reconnect/resets.
  const gameStatusRef = useRef('connecting')
  const roundRef = useRef(1)
  const scoresByUserIdRef = useRef({})
  const choicesByUserIdRef = useRef({})
  const resultRef = useRef(null)

  const { peer, peerId, connections, connectToPeer } = peerState || {}
  const isHost = lobby?.host_user_id == user?.id

  const connRef = useRef(null)
  const hostListenerAttachedRef = useRef(false)
  const guestConnectInFlightRef = useRef(false)
  const guestConnectedToRef = useRef(null)
  const resultSavedRef = useRef(false)

  const members = lobby?.members || []
  const memberByUserId = useMemo(() => {
    const m = new Map()
    for (const x of members) m.set(x.user_id, x)
    return m
  }, [members])

  const expectedPlayers = members.length

  const connectedPeersRef = useRef(new Set())
  const peerToUserIdRef = useRef(new Map())
  const nextRoundTimerRef = useRef(null)
  const roundResolvedRef = useRef(false)

  const handleDataRef = useRef(null)

  // Keep a direct list of accepted host connections for reliable broadcasting.
  const hostConnectionsRef = useRef(new Map())

  useEffect(() => {
    gameStatusRef.current = gameStatus
  }, [gameStatus])

  useEffect(() => {
    roundRef.current = round
  }, [round])

  useEffect(() => {
    scoresByUserIdRef.current = scoresByUserId || {}
  }, [scoresByUserId])

  useEffect(() => {
    choicesByUserIdRef.current = choicesByUserId || {}
  }, [choicesByUserId])

  useEffect(() => {
    resultRef.current = result
  }, [result])


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
      console.error('[RpsGame] Failed to leave lobby on server:', e)
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
        console.error('[RpsGame] Host failed to send:', c?.peer, e)
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

  const reportResult = useCallback(async ({ isDraw, winnerUserIds, loserUserIds, playerUserIds }) => {
    // to avoid double stats, only host reports
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
        body.player_user_ids = playerUserIds
      } else {
        body.winner_user_ids = winnerUserIds
        body.loser_user_ids = loserUserIds
      }

      const res = await fetch(`${API_BASE_URL}/api/games/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        console.error('[RpsGame] Failed to report result:', res.status, data)
      } else {
        console.log('[RpsGame] Result reported:', { winnerUserIds , loserUserIds, isDraw } )
    }
    } catch (e) {
      console.error('[RpsGame] Failed to report result:', e)
    }
  }, [isHost, lobby?.game_id])

  const scheduleNextRoundHost = useCallback((nextRound, scoresSnapshot) => {
    if (!isHost) return
    if (nextRound > 3) return

    if (nextRoundTimerRef.current) {
      clearTimeout(nextRoundTimerRef.current)
      nextRoundTimerRef.current = null
    }

    nextRoundTimerRef.current = setTimeout(() => {
      roundResolvedRef.current = false
      setMyChoice(null)
      setChoicesByUserId({})
      setResult(null)
      setGameStatus('playing')
      setRound(nextRound)

      // Tell guests to advance/reset too.
      broadcastFromHost({
        type: 'round-start',
        round: nextRound,
        scores_by_user_id: scoresSnapshot || {}
      })

      nextRoundTimerRef.current = null
    }, 1500)
  }, [isHost, broadcastFromHost])

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
    if (gameStatus !== 'match-over') return
    if (nextRoundTimerRef.current) {
      clearTimeout(nextRoundTimerRef.current)
      nextRoundTimerRef.current = null
    }
    closeGameConnections()
  }, [gameStatus, closeGameConnections])

  useEffect(() => {
    return () => {
      if (nextRoundTimerRef.current) {
        clearTimeout(nextRoundTimerRef.current)
        nextRoundTimerRef.current = null
      }
    }
  }, [])


  /* =====================================================================================
  // GAME-SPECIFIC LOGIC (differs per game)
  // ===================================================================================== */

  const handleData = useCallback((connPeerId, data) => {
    if (data?.type === 'game-ready') {
      setOpponentConnected(true)
      setGameStatus('playing')
      return
    }

    if (data?.type === 'player-info' && isHost) {
      const uid = Number(data.user_id)
      if (Number.isFinite(uid)) {
        peerToUserIdRef.current.set(connPeerId, uid)
      }
      return
    }

    if (data?.type === 'choice') {
      const fallbackUid = members.find((m) => m.peer_id === connPeerId)?.user_id
      const uid = isHost ? (peerToUserIdRef.current.get(connPeerId) ?? fallbackUid) : Number(data.user_id)
      const choice = String(data.choice || '')
      if (!CHOICES.includes(choice)) return

      setChoicesByUserId((prev) => ({ ...prev, [uid]: choice }))
      return
    }

    if (data?.type === 'reveal') {
      setChoicesByUserId(data.choices_by_user_id || {})
      setScoresByUserId(data.scores_by_user_id || {})
      setRound(Number(data.round) || 1)
      const matchOver = !!data.match_over
      setResult({
        is_draw: !!data.is_draw,
        winner_user_ids: data.winner_user_ids || [],
        round: Number(data.round) || 1,
        scores_by_user_id: data.scores_by_user_id || {},
        match_over: matchOver,
        match_is_draw: !!data.match_is_draw,
        match_winner_user_ids: data.match_winner_user_ids || []
      })

      if (matchOver) {
        setGameStatus('match-over')
      } else {
        setGameStatus('revealed')
      }
      return
    }

    if (data?.type === 'round-start') {
      const r = Number(data.round)
      if (Number.isFinite(r)) setRound(r)
      if (data.scores_by_user_id) setScoresByUserId(data.scores_by_user_id)
      roundResolvedRef.current = false
      setMyChoice(null)
      setChoicesByUserId({})
      setResult(null)
      setGameStatus('playing')
      return
    }

    if (data?.type === 'ended') {
      setGameStatus('match-over')
      setResult({
        is_draw: false,
        winner_user_ids: data.winner_user_ids || [],
        round: roundRef.current,
        scores_by_user_id: scoresByUserIdRef.current,
        match_over: true,
        match_is_draw: false,
        match_winner_user_ids: data.winner_user_ids || []
      })
      return
    }
  }, [isHost, members])

  useEffect(() => {
    handleDataRef.current = handleData
  }, [handleData])

  // Host networking
  useEffect(() => {
    if (!peer || !isHost) return

    console.log('[RpsGame] ✅ Starting P2P connection setup (host)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobby.id}/update-peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, peer_id: peerId })
    }).catch(err => console.error('[RpsGame] Failed to update peer_id:', err))

    const maybeReady = () => {
      const connectedGuests = connectedPeersRef.current.size
      const needGuests = Math.max(0, expectedPlayers - 1)
      const ready = connectedGuests >= needGuests
      if (ready) {
        setOpponentConnected(true)
        // Only initialize once when transitioning from connecting.
        if (gameStatusRef.current === 'connecting') {
          setGameStatus('playing')
          // init scoreboard once
          setScoresByUserId((prev) => {
            if (Object.keys(prev || {}).length) return prev
            const s = {}
            for (const m of members) s[m.user_id] = 0
            return s
          })
          setRound(1)
          broadcastFromHost({ type: 'game-ready' })
          // Explicitly start round 1 for guests.
          broadcastFromHost({ type: 'round-start', round: 1, scores_by_user_id: scoresByUserIdRef.current })
        }
      }
    }

    const sendSyncToConn = (conn) => {
      try {
        const status = gameStatusRef.current
        if (status === 'playing') {
          conn.send({ type: 'round-start', round: roundRef.current, scores_by_user_id: scoresByUserIdRef.current })
          return
        }

        if (status === 'revealed' || status === 'match-over') {
          const r = resultRef.current
          if (!r) return
          conn.send({
            type: 'reveal',
            choices_by_user_id: choicesByUserIdRef.current,
            is_draw: !!r.is_draw,
            winner_user_ids: r.winner_user_ids || [],
            round: Number(r.round) || roundRef.current,
            scores_by_user_id: scoresByUserIdRef.current,
            match_over: !!r.match_over,
            match_is_draw: !!r.match_is_draw,
            match_winner_user_ids: r.match_winner_user_ids || []
          })
        }
      } catch (e) {}
    }

    const handleConnection = (conn) => {
      console.log('[RpsGame] Host received connection from:', conn.peer)
      conn.on('open', () => {
        console.log('[RpsGame] ✅ Host connection OPENED')
        connectedPeersRef.current.add(conn.peer)
        hostConnectionsRef.current.set(conn.peer, conn)
        maybeReady()
        // ask for identity (or accept it when they send)
        try {
          conn.send({ type: 'game-ready' })
        } catch (e) {}

        // If a guest reconnects mid-game, sync current state.
        sendSyncToConn(conn)
      })

      conn.on('error', (err) => console.error('[RpsGame] Host connection error:', err))

      conn.on('data', (d) => handleDataRef.current?.(conn.peer, d))

      conn.on('close', () => {
        console.log('[RpsGame] Host connection closed')
        connectedPeersRef.current.delete(conn.peer)
        peerToUserIdRef.current.delete(conn.peer)
        hostConnectionsRef.current.delete(conn.peer)

        // if someone leaves mid-game, end for everyone: leaver loses, others win
        if (gameStatusRef.current === 'playing') {
          const quitterUserId = members.find((m) => m.peer_id === conn.peer)?.user_id
          const remaining = members.map((m) => m.user_id).filter((id) => id !== quitterUserId)
          const winners = remaining
          const losers = quitterUserId ? [quitterUserId] : []

          broadcastFromHost({ type: 'ended', winner_user_ids: winners })
          setResult({ is_draw: false, winner_user_ids: winners })
          setGameStatus('match-over')

          if (losers.length) {
            reportResult({
              isDraw: false,
              winnerUserIds: winners,
              loserUserIds: losers,
              playerUserIds: members.map((m) => m.user_id)
            })
          }
        }
      })
    }

    if (!hostListenerAttachedRef.current) {
      hostListenerAttachedRef.current = true
      peer.on('connection', handleConnection)
    }

    // host is always present
    if (expectedPlayers <= 1) {
      setGameStatus('playing')
    }

    return () => {
      if (hostListenerAttachedRef.current) {
        try {
          peer.off('connection', handleConnection)
        } catch (e) {}
        hostListenerAttachedRef.current = false
      }
    }
  }, [peer, isHost, lobby?.id, peerId, user?.id, expectedPlayers, broadcastFromHost, members, reportResult])

  // Guest networking
  useEffect(() => {
    if (!peer || isHost) return

    // Don’t reconnect mid-game; it causes round resets/desync.
    if (gameStatusRef.current !== 'connecting') return

    const lobbyId = lobby?.id
    if (!lobbyId) return

    if (connRef.current?.open) return
    if (guestConnectInFlightRef.current) return

    guestConnectInFlightRef.current = true

    console.log('[RpsGame] ✅ Starting P2P connection setup (guest)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobbyId}`)
      .then((r) => r.json())
      .then((data) => {
        const hostMember = data.members?.find((m) => m.user_id === lobby.host_user_id)
        const hostPeerId = hostMember?.peer_id
        if (!hostPeerId || !peerId) return

        if (guestConnectedToRef.current === hostPeerId && connRef.current?.open) return

        console.log('[RpsGame] Guest connecting to host:', hostPeerId)
        const conn = connectToPeer(hostPeerId)
        connRef.current = conn
        guestConnectedToRef.current = hostPeerId

        conn.on('open', () => {
          console.log('[RpsGame] ✅ Guest connected to host')
          setOpponentConnected(true)
          try {
            conn.send({ type: 'player-info', user_id: user.id, username: user.username })
          } catch (e) {}
        })

        conn.on('error', (err) => console.error('[RpsGame] Guest connection error:', err))

        conn.on('data', (d) => handleDataRef.current?.(hostPeerId, d))

        conn.on('close', () => {
          console.log('[RpsGame] Guest connection closed')
          setOpponentConnected(false)
          connRef.current = null
          guestConnectedToRef.current = null
          guestConnectInFlightRef.current = false
          setGameStatus('match-over')
        })
      })
      .catch(err => console.error('[RpsGame] Guest failed to get peer_id:', err))
      .finally(() => {
        guestConnectInFlightRef.current = false
      })
  }, [peer, isHost, lobby?.id, lobby?.host_user_id, peerId, connectToPeer, user?.id, user?.username])

  // Host: when all choices collected, reveal
  useEffect(() => {
    if (!isHost) return
    if (gameStatus !== 'playing') return

    const myUid = Number(user?.id)
    const allUserIds = members.map((m) => m.user_id)

    // include host choice
    const full = { ...choicesByUserId }
    if (myChoice) full[myUid] = myChoice

    const allPicked = allUserIds.length > 0 && allUserIds.every((id) => !!full[id])
    if (!allPicked) return

    // Guard: prevent re-running the reveal logic multiple times per round
    // (can happen if state updates cause this effect to re-trigger while still "playing").
    if (roundResolvedRef.current) return
    roundResolvedRef.current = true

    const computed = computeWinners(full)
    const roundWinnerUserIds = computed.isDraw ? [] : computed.winnerUserIds

    // update scoreboard
    const nextScores = { ...(scoresByUserId || {}) }
    for (const id of allUserIds) {
      if (!Object.prototype.hasOwnProperty.call(nextScores, id)) nextScores[id] = 0
    }
    for (const w of roundWinnerUserIds) {
      nextScores[w] = (nextScores[w] || 0) + 1
    }

    const maxScore = Math.max(0, ...Object.values(nextScores))
    const matchWinnerUserIds = allUserIds.filter((id) => (nextScores[id] || 0) === maxScore)
    const matchIsDraw = matchWinnerUserIds.length !== 1
    const matchOver = maxScore >= 2 || round >= 3

    const payload = {
      type: 'reveal',
      choices_by_user_id: full,
      is_draw: computed.isDraw,
      winner_user_ids: roundWinnerUserIds,
      round,
      scores_by_user_id: nextScores,
      match_over: matchOver,
      match_is_draw: matchOver ? matchIsDraw : false,
      match_winner_user_ids: matchOver ? matchWinnerUserIds : []
    }

    broadcastFromHost(payload)
    setChoicesByUserId(full)
    setScoresByUserId(nextScores)
    setResult({
      is_draw: computed.isDraw,
      winner_user_ids: roundWinnerUserIds,
      round,
      scores_by_user_id: nextScores,
      match_over: matchOver,
      match_is_draw: matchOver ? matchIsDraw : false,
      match_winner_user_ids: matchOver ? matchWinnerUserIds : []
    })

    if (matchOver) {
      setGameStatus('match-over')

      const allPlayers = allUserIds
      if (matchIsDraw) {
        reportResult({ isDraw: true, playerUserIds: allPlayers })
      } else {
        const winners = matchWinnerUserIds
        const losers = allPlayers.filter((id) => !winners.includes(id))
        reportResult({
          isDraw: false,
          winnerUserIds: winners,
          loserUserIds: losers,
          playerUserIds: allPlayers
        })
      }
    } else {
      setGameStatus('revealed')
      scheduleNextRoundHost(Math.min(3, round + 1), nextScores)
    }
  }, [isHost, gameStatus, myChoice, choicesByUserId, members, user?.id, broadcastFromHost, reportResult, round, scoresByUserId, scheduleNextRoundHost])

  const pick = (choice) => {
    if (gameStatus !== 'playing') return
    if (!CHOICES.includes(choice)) return
    if (myChoice) return

    setMyChoice(choice)

    if (isHost) {
      return
    }

    sendGameData({ type: 'choice', user_id: user.id, choice })
  }

  const myResultText = useMemo(() => {
    if (!result) return ''

    const matchOver = !!result.match_over
    if (matchOver) {
      if (result.match_is_draw) return '🤝 Draw'
      const winners = result.match_winner_user_ids || []
      const iWon = winners.includes(Number(user.id))
      return iWon ? '🎉 You won!' : '😔 You lost!'
    }

    if (result.is_draw) return '🤝 Draw'
    const winners = result.winner_user_ids || []
    const iWon = winners.includes(Number(user.id))
    return iWon ? '🎉 You won!' : '😔 You lost!'
  }, [result, user?.id])

  const renderChoice = (c) => {
    if (c === 'rock') return '🪨 Rock'
    if (c === 'paper') return '📄 Paper'
    return '✂️ Scissors'
  }

  const handleExit = () => {
    // Close P2P to trigger host-side disconnect handling, then leave lobby in DB.
    closeGameConnections()
    leaveLobbyOnServer()
    onExit?.()
  }

  return (
    <div className="rps-game-container">
      <div className="game-header">
        <button className="back-btn" onClick={handleExit}>← Leave Game</button>
        <h1>Sasso Carta Forbici</h1>
        <div className="status-indicator">
          <span className={`indicator-dot ${opponentConnected ? 'connected' : ''}`} />
          {opponentConnected ? 'Connected' : 'Connecting...'}
        </div>
      </div>

      <div className={`game-status ${gameStatus}`}>
        {gameStatus === 'connecting'
          ? '🔄 Connecting...'
          : gameStatus === 'playing'
            ? `Round ${round}/3 - Pick your choice`
            : gameStatus === 'revealed'
              ? `Round ${round}/3 - ${myResultText}`
              : `Final - ${myResultText}`}
      </div>

      {gameStatus === 'playing' && (
        <div className="rps-actions">
          {CHOICES.map((c) => (
            <button key={c} className="btn-play" onClick={() => pick(c)} disabled={!!myChoice}>
              {renderChoice(c)}
            </button>
          ))}
          {myChoice && <div className="rps-picked">You picked: {renderChoice(myChoice)}</div>}
        </div>
      )}

      {(gameStatus === 'revealed' || gameStatus === 'match-over') && (
        <div className="rps-results">
          <div className="rps-results-title">Results</div>
          <div className="rps-results-list">
            {members.map((m) => (
              <div key={m.user_id} className="rps-result-row">
                <span className="name">{m.user_id === user.id ? 'You' : m.username}</span>
                <span className="choice">{renderChoice(choicesByUserId[m.user_id])} ({scoresByUserId[m.user_id] || 0})</span>
              </div>
            ))}
          </div>
          <button className="exit-btn" onClick={handleExit}>🚪 Exit</button>
        </div>
      )}
    </div>
  )
}
