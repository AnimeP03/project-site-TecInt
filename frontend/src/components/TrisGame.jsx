import React, { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE_URL } from '../config'


//combinazioni vincenti
const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], 
  [0, 3, 6], [1, 4, 7], [2, 5, 8], 
  [0, 4, 8], [2, 4, 6]            
]

export default function TrisGame({ lobby, user, peerState, onExit }) {
  //info del gioco
  const [board, setBoard] = useState(Array(9).fill(null))
  const [isMyTurn, setIsMyTurn] = useState(false)
  const [opponentConnected, setOpponentConnected] = useState(false)
  const [gameStatus, setGameStatus] = useState('connecting') // 'connecting' | 'playing' | 'won' | 'lost' | 'draw'
  //dato che non fa render ad ogni cambio di stato
  const gameStatusRef = useRef('connecting')
  
  //info peerjs
  const { peer, peerId, connections, connectToPeer } = peerState || {}
  const isHost = lobby?.host_user_id == user?.id
  const connRef = useRef(null)
  const hostListenerAttachedRef = useRef(false)
  const primaryOpponentPeerRef = useRef(null)
  const dataHandlerRef = useRef(null)
  const resultSavedRef = useRef(false)
  const connectionsClosedRef = useRef(false)
  const guestConnectInFlightRef = useRef(false)
  const guestConnectedToRef = useRef(null)


  // Host is X, guest is O
  const mySymbol = isHost ? 'X' : 'O'
  const opponentSymbol = isHost ? 'O' : 'X'
  
  // info opponent
  const opponentMember = lobby?.members?.find(m => m.user_id != user?.id)
  const opponentName = opponentMember?.username || 'Opponent'
  const opponentPeerId = opponentMember?.peer_id
  const opponentUserId = opponentMember?.user_id

  // se esiste opponentUserId e user.id e lobby id posso fare report del risultato
  const canReportResult = !!(lobby?.game_id && user?.id && opponentUserId)

  useEffect(() => {
    gameStatusRef.current = gameStatus
  }, [gameStatus])


  /* =====================================================================================
  // SHARED HELPERS (same idea in all games)
  // ===================================================================================== */


  /*
  //
  //quando la partita finisce, salvo il risultato nel db(stats)
  //
  */
  const reportResult = useCallback(async ({ outcome}) => {
    if (!isHost) return
    if (resultSavedRef.current) return
    if (!canReportResult) return
    if (outcome !== 'won' && outcome !== 'lost' && outcome !== 'draw') return

    resultSavedRef.current = true

    try {
      const isDraw = outcome === 'draw'
      const winnerUserId = isDraw ? null : (outcome === 'won' ? user.id : opponentUserId)
      const loserUserId = isDraw ? null : (outcome === 'won' ? opponentUserId : user.id)

      //invio richiesta al backend
      const body = {
        game_id: lobby.game_id,
        winner_user_id: winnerUserId,
        loser_user_id: loserUserId,
        is_draw: isDraw
      }

      // se draw, invio qualsiasi cosa , basta che non ci sia null 
      if (isDraw) {
        body.winner_user_id = user.id
        body.loser_user_id = opponentUserId
      }

      const res = await fetch(`${API_BASE_URL}/api/games/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => null)
        console.error('[TrisGame] Failed to report result:', res.status, data)
      } else {
        console.log('[TrisGame] Result reported:', { outcome })
      }
    } catch (e) {
      console.error('[TrisGame] Failed to report result:', e)
    }
  }, [canReportResult, lobby?.game_id, opponentUserId, user?.id])

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
      console.error('[TrisGame] Failed to leave lobby on server:', e)
    }
  }, [lobby?.id, user?.id])

  /*
  //
  //chiudere connessioni p2p dopo la fine della partita (per piu di un guest)
  //
  */
  const closeGameConnections = useCallback(() => {
    // per evitare chiamate multiple
    if (connectionsClosedRef.current) return
    connectionsClosedRef.current = true

    try {
      // chiudi connessione guest
      connRef.current?.close?.()
      connRef.current = null

      // chiudi altre connessioni
      const conns = Object.values(connections || {})

      if (isHost) {
        const primaryPeerId = primaryOpponentPeerRef.current
        const primaryConn = primaryPeerId ? connections?.[primaryPeerId] : null

        if (primaryConn?.open) {
          primaryConn.close()
        } else {
          conns.forEach(c => c?.open && c.close())
        }
      } else {
        // Guest: chiudi tutte le connessioni aperte
        conns.forEach(c => c?.open && c.close())
      }
    } catch (e) {
      console.error('Error closing connections:', e)
    } finally {
      setOpponentConnected(false)
    }
  }, [connections, isHost])

  // quando finisce la partita, chiudo connessioni p2p 
  useEffect(() => {
    const finished = gameStatus === 'won' || gameStatus === 'lost' || gameStatus === 'draw'
    if (!finished) return
    closeGameConnections()
  }, [gameStatus, closeGameConnections])//se non aggiungo closeGameConnections da warning


  /*
  //
  //gestire la fine della partita per abbandono durante un partita attiva
  //
  */
  const finishByForfeit = useCallback((winnerIsMe) => {
    if (gameStatusRef.current !== 'playing') return

    const next = winnerIsMe ? 'won' : 'lost'
    setGameStatus(next)
    setIsMyTurn(false)

    // Fire-and-forget stats save
    reportResult({ outcome: next })

    //If someone quit mid-game, clean up the lobby so it doesn't remain stuck.
    if (!winnerIsMe) {  
      leaveLobbyOnServer()
    }  
  }, [reportResult, leaveLobbyOnServer])


  /* =====================================================================================
  // GAME-SPECIFIC LOGIC (differs per game)
  // ===================================================================================== */

  /*
  //
  //controllo vincitore
  //
  */
  const checkWinner = useCallback((squares) => {
    for (const [a, b, c] of WINNING_COMBOS) {
      if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
        return squares[a]
      }
    }
    return null
  }, [])

  /*
  //
  //gestione messaggi in arrivo p2p
  //
  */
  const handleData = useCallback((data) => {
    
    //quando la connecsione e pronta e il nemico e pronto
    if (data.type === 'game-ready') {
      setOpponentConnected(true)
      setGameStatus('playing')
    }
    
    //ogni mossa ricevuta
    if (data.type === 'move') {
      setBoard(prev => {
        const newBoard = [...prev]
        newBoard[data.index] = data.symbol
        
        const winnerSymbol = checkWinner(newBoard)
        if (winnerSymbol) {
          const outcome = winnerSymbol === mySymbol ? 'won' : 'lost'
          setGameStatus(outcome)
          reportResult({ outcome })
        } else if (newBoard.every(cell => cell !== null)) {
          setGameStatus('draw')
          reportResult({ outcome: 'draw' })
        }
        
        return newBoard
      })
      setIsMyTurn(true)
    }

    /*
    if (data.type === 'rematch') {
      setBoard(Array(9).fill(null))
      setGameStatus('playing')
      resultSavedRef.current = false
      connectionsClosedRef.current = false
      // After rematch, non-host goes first
      setIsMyTurn(!isHost)
    }*/

    if (data.type === 'forfeit') {
      finishByForfeit(true)
    }

  }, [checkWinner, mySymbol, isHost, reportResult, finishByForfeit, leaveLobbyOnServer, onExit])

  // per non mandare una nuova funzione a ogni render
  useEffect(() => {
    dataHandlerRef.current = handleData
  }, [handleData])


  /* 
  //
  //gestione connessioni p2p (host che manda a tutti i guest)
  //
  */
  const broadcastFromHost = useCallback((data) => {
    const conns = Object.values(connections || {})
    for (const c of conns) {
      if (c?.open) {
        try {
          c.send(data)
        } catch (e) {
          console.error('[TrisGame] Host failed to send to peer:', c?.peer, e)
        }
      }
    }
  }, [connections])


  /* -----------------------------------------------------------------------------------------*/
  // Host: accetta connessioni in arrivo
  useEffect(() => {
    if (!peer || !isHost) return

    console.log('[TrisGame] ✅ Starting P2P connection setup (host)...')

    // Aggiorna il nostro peer_id corrente nel database (nel caso sia cambiato)
    fetch(`${API_BASE_URL}/api/lobbies/${lobby.id}/update-peer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: user.id, peer_id: peerId })
    }).catch(err => console.error('[TrisGame] Failed to update peer_id:', err))

    // Host: accetta connessioni in arrivo (possono essere multiple)
    const handleConnection = (conn) => {
      console.log('[TrisGame] Host received connection from:', conn.peer)

      // il primo peer che si connette e' l'avversario attivo
      if (!primaryOpponentPeerRef.current) {
        primaryOpponentPeerRef.current = conn.peer
        console.log('[TrisGame] Host primary opponent set to:', conn.peer)
      }

      conn.on('open', () => {
        console.log('[TrisGame] ✅ Host connection OPENED')
        setOpponentConnected(true)
        setGameStatus('playing')
        // host va sempre primo
        setIsMyTurn(true)

        // Invia ready al peer appena connesso (garantito)
        try {
          conn.send({ type: 'game-ready' })
        } catch (e) {
          console.error('[TrisGame] Host failed to send game-ready:', e)
        }

        // ...e manda anche a tutti gli altri peer connessi (sync globale)
        broadcastFromHost({ type: 'game-ready' })
      })

      conn.on('error', (err) => console.error('[TrisGame] Host connection error:', err))

      conn.on('data', (d) => {
        // ricevo info solo dal peer attivo , se ci sono spettatori li ignoro
        if (primaryOpponentPeerRef.current && conn.peer !== primaryOpponentPeerRef.current) {
          console.warn('[TrisGame] Ignoring data from non-primary peer:', conn.peer, d)
          return
        }
        dataHandlerRef.current?.(d)
      })

      conn.on('close', () => {
        console.log('[TrisGame] Host connection closed')
        if (primaryOpponentPeerRef.current === conn.peer) {
          primaryOpponentPeerRef.current = null
        }

        const anyOpen = Object.values(connections || {}).some((c) => c?.open)
        setOpponentConnected(anyOpen)

        // se il nemico si disconnette durante la partita attiva, vinco per abbandono
        if (!anyOpen) {
          finishByForfeit(true)
        }
      })
    }

    // Only attach listener once per component lifetime
    if (!hostListenerAttachedRef.current) {
      hostListenerAttachedRef.current = true
      peer.on('connection', handleConnection)
    }

    // 
    const anyOpen = Object.values(connections || {}).some((c) => c?.open)
    if (anyOpen) {
      setOpponentConnected(true)
      setGameStatus('playing')
      setIsMyTurn(true)
      if (!primaryOpponentPeerRef.current) {
        const firstOpen = Object.values(connections || {}).find((c) => c?.open)
        if (firstOpen) primaryOpponentPeerRef.current = firstOpen.peer
      }
    }

    return () => {
      if (hostListenerAttachedRef.current) {
        try {
          peer.off('connection', handleConnection)
        } catch (e) {
          // older runtimes may not support off()
        }
        hostListenerAttachedRef.current = false
      }
    }
  }, [peer, isHost, lobby?.id, peerId, user?.id, connections, finishByForfeit])

  /* -----------------------------------------------------------------------------------------*/
  // Guest: si connete al host usando il peer_id ottenuto dal server
  useEffect(() => {
    if (!peer || isHost) return

    const lobbyId = lobby?.id
    if (!lobbyId) return

    if (connRef.current?.open) return

    if (guestConnectInFlightRef.current) return

    guestConnectInFlightRef.current = true
    console.log('[TrisGame] ✅ Starting P2P connection setup (guest)...')

    fetch(`${API_BASE_URL}/api/lobbies/${lobbyId}`)
      .then(r => r.json())
      .then(data => {
        const hostMember = data.members?.find(m => m.user_id === lobby.host_user_id)
        const hostPeerId = hostMember?.peer_id

        if (!hostPeerId || !peerId) return

        // per non riconnettersi se gia' connesso
        if (guestConnectedToRef.current === hostPeerId && connRef.current?.open) return

        console.log('[TrisGame] Guest connecting to host:', hostPeerId)
        const conn = connectToPeer(hostPeerId)
        connRef.current = conn
        guestConnectedToRef.current = hostPeerId

        if (conn) {
          conn.on('open', () => {
            console.log('[TrisGame] ✅ Guest connected to host')
            setOpponentConnected(true)
            setGameStatus('playing')
            setIsMyTurn(false) 
            try {
              conn.send({ type: 'game-ready' })
            } catch (e) {}
          })

          conn.on('error', (err) => console.error('[TrisGame] Guest connection error:', err))
          conn.on('data', (d) => dataHandlerRef.current?.(d))
          conn.on('close', () => {
            console.log('[TrisGame] Guest connection closed')
            setOpponentConnected(false)
            connRef.current = null
            guestConnectedToRef.current = null
            guestConnectInFlightRef.current = false

            // host esce durante partita attiva, vinco per abbandono
            finishByForfeit(true)
          })
        }
      })
      .catch(err => console.error('[TrisGame] Guest failed to get peer_id:', err))
      .finally(() => {
        guestConnectInFlightRef.current = false
      })
  }, [peer, isHost, lobby?.id, lobby?.host_user_id, peerId, connectToPeer, finishByForfeit])

  /*
  // Manda datì al nemico:
  // - Host broadcasts to all connected peers
  // - Guest sends to host connection
  */
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
    if (fallback) {
      fallback.send(data)
    }
  }, [isHost, broadcastFromHost, connections])

  /*
  //
  //  gestione click sulle celle
  //
  */
  const handleCellClick = (index) => {
    if (!isMyTurn || board[index] || gameStatus !== 'playing') return

    const newBoard = [...board]
    newBoard[index] = mySymbol
    setBoard(newBoard)
    setIsMyTurn(false)

    // manda il mio turno 
    sendGameData({ type: 'move', index, symbol: mySymbol })

    // controllo vincitore
    const winnerSymbol = checkWinner(newBoard)
    if (winnerSymbol) {
      setGameStatus('won')
      reportResult({ outcome: 'won' })
    } else if (newBoard.every(cell => cell !== null)) {
      setGameStatus('draw')
      reportResult({ outcome: 'draw' })
    }
  }

  /*// Rematch
  const requestRematch = () => {
    setBoard(Array(9).fill(null))
    setGameStatus('playing')
    resultSavedRef.current = false
    connectionsClosedRef.current = false
    setIsMyTurn(isHost) // Host goes first again
    sendGameData({ type: 'rematch' })
  }*/


  /*
  //
  // gestione uscita dalla partita
  //
  */
  const handleExit = () => {
  
    // Se esco durante una partita attiva, notifico l'avversario e conto come sconfitta per abbandono.
    if (gameStatus === 'playing') {
      try {
        sendGameData({ type: 'forfeit' })
      } catch (e) {
        // ignora
      }
      finishByForfeit(false)
    } else {
      // partita finalizzata normalmente, lascio la lobby
      leaveLobbyOnServer()
    }

    onExit?.()
  }

  /*
  // 
  // mostra messaggio stato partita 
  //
  */ 
  const getStatusMessage = () => {
    switch (gameStatus) {
      case 'connecting':
        return '🔄 Connecting to opponent...'
      case 'playing':
        return isMyTurn ? `Your turn (${mySymbol})` : `${opponentName}'s turn (${opponentSymbol})`
      case 'won':
        return '🎉 You won!'
      case 'lost':
        return '😔 You lost!'
      case 'draw':
        return "🤝 It's a draw!"
      default:
        return ''
    }
  }

  return (
    <div className="tris-game-container">
      <div className="game-header">
        <button className="back-btn" onClick={handleExit}>← Leave Game</button>
        <h1>Tic Tac Toe</h1>
        <div className="status-indicator">
          <span className={`indicator-dot ${opponentConnected ? 'connected' : ''}`} />
          {opponentConnected ? 'Connected' : 'Connecting...'}
        </div>
      </div>

      <div className="tris-players">
        <div className={`player-badge ${isMyTurn && gameStatus === 'playing' ? 'active' : ''}`}>
          <span className={`symbol ${mySymbol.toLowerCase()}`}>{mySymbol}</span>
          <span className="name">You</span>
        </div>
        <span className="vs">VS</span>
        <div className={`player-badge ${!isMyTurn && gameStatus === 'playing' ? 'active' : ''}`}>
          <span className={`symbol ${opponentSymbol.toLowerCase()}`}>{opponentSymbol}</span>
          <span className="name">{opponentName}</span>
        </div>
      </div>

      <div className={`game-status ${gameStatus}`}>
        {getStatusMessage()}
      </div>

      <div className="tris-board">
        {board.map((cell, index) => (
          <button
            key={index}
            className={`tris-cell ${cell ? 'filled' : ''} ${cell === 'X' ? 'x' : cell === 'O' ? 'o' : ''}`}
            onClick={() => handleCellClick(index)}
            disabled={!isMyTurn || cell || gameStatus !== 'playing'}
          >
            {cell}
          </button>
        ))}
      </div>

      {(gameStatus === 'won' || gameStatus === 'lost' || gameStatus === 'draw') && (
        <div className="game-over-actions">
          <button className="exit-btn" onClick={handleExit}>
            🚪 Exit
          </button>
        </div>
      )}
    </div>
  )
}
