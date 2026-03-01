const express = require('express')
const pool = require('../db')

const router = express.Router()

// list open and playing lobbies for a game
router.get('/', async (req, res) => {
  const gameId = req.query.game_id
  try {
    const [rows] = await pool.query(
      `SELECT l.*, u.username AS host_username,
         (SELECT COUNT(*) FROM lobby_members m WHERE m.lobby_id = l.id) AS members_count
       FROM lobbies l
       JOIN users u ON l.host_user_id = u.id
       WHERE l.game_id = ? AND (l.status = 'Open' OR l.status = 'Playing')
       ORDER BY l.created_at DESC`,
      [gameId]
    )
    res.json({ lobbies: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// create a lobby
router.post('/createlobby', async (req, res) => {
  const { game_id, host_user_id, max_players, peer_id, is_private, password } = req.body

  if (!game_id || !host_user_id || !peer_id) {
    return res.status(400).json({ error: 'Missing Params' })
  }

  // se privata, password obbligatoria
  if (is_private && !password) {
    return res.status(400).json({ error: 'Password required for private lobby' })
  }

  try {
    //crea lobby in database
    const [result] = await pool.query(
      'INSERT INTO lobbies (game_id, host_user_id, max_players, is_private, password, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
      [game_id, host_user_id, max_players || 2, is_private ? 1 : 0, is_private ? password : null]
    )
    const lobbyId = result.insertId

    //aggiungi host come membro (host is always ready)
    await pool.query('INSERT INTO lobby_members (lobby_id, user_id, peer_id, is_ready, joined_at) VALUES (?, ?, ?, 1, NOW())', [lobbyId, host_user_id, peer_id])

    const [rows] = await pool.query('SELECT * FROM lobbies WHERE id = ?', [lobbyId])
    res.status(201).json({ lobby: rows[0] })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// join a lobby
router.post('/:id/join', async (req, res) => {
  const lobbyId = req.params.id
  const { user_id, peer_id, password } = req.body

  if (!user_id || !peer_id) {
    return res.status(400).json({ error: 'Missing Params' })
  }

  try {
    //cerca la lobby
    const [lrows] = await pool.query('SELECT * FROM lobbies WHERE id = ?', [lobbyId])
    if (!lrows.length) return res.status(404).json({ error: 'Lobby Not Found' })
    const lobby = lrows[0]
    if (lobby.status !== 'Open') return res.status(400).json({ error: 'Lobby Already Playing' })
    
    // controlla password se privata
    if (lobby.is_private) {
      if (!password) return res.status(400).json({ error: 'Password Required' })
      if (password !== lobby.password) return res.status(403).json({ error: 'Wrong Password' })
    }
    
    //controlla se user è già membro o se la lobby è piena
    const [existingMember] = await pool.query('SELECT * FROM lobby_members WHERE lobby_id = ? AND user_id = ?', [lobbyId, user_id])
    if (existingMember.length > 0) return res.status(400).json({ error: 'Already in Lobby' })
    
    const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM lobby_members WHERE lobby_id = ?', [lobbyId])
    const cnt = countRows[0].cnt
    if (cnt >= lobby.max_players) return res.status(400).json({ error: 'Lobby Full' })

    //aggiungi come membro
    await pool.query('INSERT INTO lobby_members (lobby_id, user_id, peer_id, joined_at) VALUES (?, ?, ?, NOW())', [lobbyId, user_id, peer_id])
    res.status(201).json({ lobby_id: lobbyId })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server error' })
  }
})

// get lobby members
router.get('/:id/members', async (req, res) => {
  const lobbyId = req.params.id
  try {
    const [rows] = await pool.query(
      `SELECT lm.*, u.username, u.email 
       FROM lobby_members lm 
       JOIN users u ON lm.user_id = u.id 
       WHERE lm.lobby_id = ?`,
      [lobbyId]
    )
    res.status(201).json({ members: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// get full lobby details (for lobby room view)
router.get('/:id', async (req, res) => {
  const lobbyId = req.params.id
  try {
    const [lrows] = await pool.query(
      `SELECT l.*, u.username AS host_username, g.name AS game_name
       FROM lobbies l
       JOIN users u ON l.host_user_id = u.id
       JOIN games g ON l.game_id = g.id
       WHERE l.id = ?`,
      [lobbyId]
    )
    if (!lrows.length) return res.status(404).json({ error: 'Lobby Not Found' })
    
    const [members] = await pool.query(
      `SELECT lm.*, u.username 
       FROM lobby_members lm 
       JOIN users u ON lm.user_id = u.id 
       WHERE lm.lobby_id = ?`,
      [lobbyId]
    )
    
    res.json({ lobby: lrows[0], members })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// toggle ready status
router.post('/:id/ready', async (req, res) => {
  const lobbyId = req.params.id
  const { user_id, peer_id } = req.body

  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })

  try {
    // Toggle is_ready and 
    if (peer_id) {
      await pool.query(
        `UPDATE lobby_members SET is_ready = NOT is_ready, peer_id = ? WHERE lobby_id = ? AND user_id = ?`,
        [peer_id, lobbyId, user_id]
      )
    } else {
      await pool.query(
        `UPDATE lobby_members SET is_ready = NOT is_ready WHERE lobby_id = ? AND user_id = ?`,
        [lobbyId, user_id]
      )
    }
    
    const [rows] = await pool.query(
      `SELECT is_ready FROM lobby_members WHERE lobby_id = ? AND user_id = ?`,
      [lobbyId, user_id]
    )
    
    res.json({ is_ready: rows[0]?.is_ready === 1 })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})
// start game (host only)
router.post('/:id/start', async (req, res) => {
  const lobbyId = req.params.id
  const { user_id } = req.body

  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })

  try {
    // Check if user is host
    const [lrows] = await pool.query('SELECT * FROM lobbies WHERE id = ?', [lobbyId])
    if (!lrows.length) return res.status(404).json({ error: 'Lobby Not Found' })
    
    const lobby = lrows[0]
    if (lobby.host_user_id != user_id) {
      return res.status(403).json({ error: 'Only host can start the game' })
    }
    
    // Check if all members are ready
    const [notReady] = await pool.query(
      `SELECT COUNT(*) as cnt FROM lobby_members WHERE lobby_id = ? AND is_ready = 0`,
      [lobbyId]
    )
    
    if (notReady[0].cnt > 0) {
      return res.status(400).json({ error: 'Not all players are ready' })
    }
    
    // Update lobby status to Playing
    await pool.query(`UPDATE lobbies SET status = 'Playing' WHERE id = ?`, [lobbyId])
    
    res.json({ started: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// update peer_id for a member
router.post('/:id/update-peer', async (req, res) => {
  const lobbyId = req.params.id
  const { user_id, peer_id } = req.body

  if (!user_id || !peer_id) return res.status(400).json({ error: 'Missing user_id or peer_id' })

  try {
    await pool.query(
      `UPDATE lobby_members SET peer_id = ? WHERE lobby_id = ? AND user_id = ?`,
      [peer_id, lobbyId, user_id]
    )
    res.json({ updated: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

// leave a lobby
router.post('/:id/leave', async (req, res) => {
  const lobbyId = req.params.id
  const { user_id } = req.body

  if (!user_id) return res.status(400).json({ error: 'Missing user_id' })

  try {
    const [lrows] = await pool.query('SELECT * FROM lobbies WHERE id = ?', [lobbyId])
    if (!lrows.length) return res.status(404).json({ error: 'Lobby Not Found' })
    
    const lobby = lrows[0]
    
    // in lobby di waiting, se esce host, elimina lobby
    if (lobby.host_user_id == user_id && lobby.status === 'Open') {
      await pool.query('DELETE FROM lobby_members WHERE lobby_id = ?', [lobbyId])
      await pool.query('DELETE FROM lobbies WHERE id = ?', [lobbyId])
      return res.json({ deleted: true })
    }
    
    // se non host o in gioco, rimuovi solo membro
    await pool.query('DELETE FROM lobby_members WHERE lobby_id = ? AND user_id = ?', [lobbyId, user_id])

    // se una persona quita in gioco, elimina lobby
    /*const status = String(lobby.status || '').toLowerCase()
    if (status === 'playing') {
      await pool.query('DELETE FROM lobbies WHERE id = ?', [lobbyId])
      return res.json({ deleted: true })
    }*/

    // se nessuno rimasto, elimina lobby
    const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM lobby_members WHERE lobby_id = ?', [lobbyId])
    if ((countRows[0]?.cnt || 0) === 0) {
      await pool.query('DELETE FROM lobbies WHERE id = ?', [lobbyId])
      return res.json({ deleted: true })
    }

    res.json({ left: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})

module.exports = router
