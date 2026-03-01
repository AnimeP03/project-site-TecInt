const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const http = require('http')
const { PeerServer } = require('peer')
const auth = require('./routes/auth')
const games = require('./routes/games')
const lobbies = require('./routes/lobbies')

dotenv.config()

const app = express()
const server = http.createServer(app)

app.use(cors())
app.use(express.json())

app.use('/api/auth', auth)
app.use('/api/games', games)
app.use('/api/lobbies', lobbies)

//solo per controllo server in funzione
app.get('/ping', (req, res) => res.json({ ok: true }))

const port = process.env.PORT 
const peerPort = process.env.PEER_PORT 

// Start main server on all interfaces (0.0.0.0)
server.listen(port, '0.0.0.0', () => {
  console.log('Server running on port', port)
})

// Start PeerServer with configuration from .env
const peerServer = require('peer').PeerServer({
  port: peerPort,
  path: process.env.PEER_PATH ,
  host: process.env.PEER_HOST ,
  debug: parseInt(process.env.PEER_DEBUG) ,
  allow_discovery: process.env.PEER_ALLOW_DISCOVERY === 'true'
})

peerServer.on('connection', (client) => {
  console.log('[PeerServer] Peer connected:', client.getId())
})

peerServer.on('disconnect', (client) => {
  console.log('[PeerServer] Peer disconnected:', client.getId())
})

console.log('[PeerServer] PeerServer running on port', peerPort)
