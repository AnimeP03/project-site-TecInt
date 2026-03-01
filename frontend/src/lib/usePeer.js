import { useCallback, useEffect, useRef, useState } from 'react'
import { Peer } from 'peerjs'

function createPeer(userId) {
  
  const peerHost = import.meta.env.VITE_PEER_HOST || window.location.hostname
  const peerPort = parseInt(import.meta.env.VITE_PEER_PORT) 
  const peerProtocol = import.meta.env.VITE_PEER_PROTOCOL || (window.location.protocol === 'https:' ? 'wss' : 'http')
  const peerPath = import.meta.env.VITE_PEER_PATH 
  
  // For HTTPS/WSS deployments, typically port 443
  const actualPort = peerProtocol === 'wss' && peerPort === 9000 ? 443 : peerPort
  
  // Use signalling server to find peers
  const config = {
    host: peerHost,
    port: actualPort,
    path: peerPath,
    secure: peerProtocol === 'wss',  // true for HTTPS/WSS
    config: {
      // STUN + TURN servers: helps ICE negotiation across NAT/firewalls
      // Add your own TURN server for production (coturn, xirsys, etc)
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    },
    debug: 2,
  }
  
  const peer = new Peer(undefined, config)

  peer.on('error', (err) => {
    console.error('[usePeer] Peer error:', err)
  })
  
  peer.on('disconnected', () => {
    console.warn('[usePeer] Peer disconnected from server')
  })

  peer.on('close', () => {
    console.warn('[usePeer] Peer connection closed')
  })

  return peer
}

export function usePeer(userId) {
  const [peer, setPeer] = useState(null)
  const [connections, setConnections] = useState({})
  const [peerId, setPeerId] = useState(null)
  const [ready, setReady] = useState(false)
  const connectionsRef = useRef({})

  useEffect(() => {
    connectionsRef.current = connections || {}
  }, [connections])

  useEffect(() => {
    if (!userId) {
      setReady(false)
      setPeerId(null)
      return
    }

    const p = createPeer(userId)

    const timeout = setTimeout(() => {
      setReady(false)
    }, 5000)

    p.on('open', (id) => {
      clearTimeout(timeout)
      setPeerId(id)
      setReady(true)
    })

    p.on('connection', (conn) => {
      conn.on('open', () => {
        setConnections((s) => ({ ...s, [conn.peer]: conn }))
      })
      
      conn.on('error', (err) => {
        console.error('[usePeer] Connection error:', err)
      })
      
      conn.on('close', () => {
        setConnections((s) => {
          const copy = { ...s }
          delete copy[conn.peer]
          return copy
        })
      })
      
      conn.on('data', (d) => {
        console.log('[usePeer] Data received:', d)
      })
    })

    p.on('error', (err) => {
      clearTimeout(timeout)
      console.error('[usePeer] Peer error:', err)
      setReady(false)
    })

    setPeer(p)

    return () => {
      clearTimeout(timeout)
      try {
        p.destroy()
      } catch (e) {}
    }
  }, [userId])

  const connectToPeer = useCallback((remotePeerId) => {
    if (!peer) {
      console.error('[connectToPeer] peer not ready')
      return null
    }

    // Reuse existing connection if already open
    const existing = connectionsRef.current?.[remotePeerId]
    if (existing?.open) {
      return existing
    }
    
    const conn = peer.connect(remotePeerId)
    
    conn.on('open', () => {
      setConnections((s) => ({ ...s, [conn.peer]: conn }))
      conn.send({ type: 'hello', from: peer.id })
    })
    
    conn.on('error', (err) => {
      console.error('[connectToPeer] Connection error:', err)
    })
    
    conn.on('close', () => {
      setConnections((s) => {
        const copy = { ...s }
        delete copy[conn.peer]
        return copy
      })
    })
    
    conn.on('data', (d) => {
      console.log('[connectToPeer] Data received:', d)
    })
    
    return conn
  }, [peer])

  const sendData = useCallback((peerId, data) => {
    const conn = connectionsRef.current?.[peerId]
    if (conn && conn.open) {
      conn.send(data)
    }
  }, [])

  return {
    peer,
    peerId,
    ready,
    connections,
    connectToPeer,
    sendData,
  }
}
