const express = require('express')
const pool = require('../db')

const router = express.Router()

// Body:
//  - game_id: number
//  - winner_user_id: number (required if not draw)
//  - loser_user_id: number (required if not draw)
//  - is_draw: boolean (optional)
router.post('/result', async (req, res) => {
  const {
    game_id,
    winner_user_id,
    loser_user_id,
    is_draw,
    winner_user_ids,
    loser_user_ids,
    player_user_ids
  } = req.body || {}

  //controllo parametri
  if (!game_id) return res.status(400).json({ error: 'Missing game_id' })

  const draw = !!is_draw

  const winnersArr = Array.isArray(winner_user_ids) ? winner_user_ids.map(Number).filter(Number.isFinite) : null
  const losersArr = Array.isArray(loser_user_ids) ? loser_user_ids.map(Number).filter(Number.isFinite) : null
  const playersArr = Array.isArray(player_user_ids) ? player_user_ids.map(Number).filter(Number.isFinite) : null

  // If not draw, validate either legacy pair OR arrays
  if (!draw) {
    const usingArrays = Array.isArray(winnersArr) && winnersArr.length > 0 && Array.isArray(losersArr) && losersArr.length > 0
    if (!usingArrays) {
      if (!winner_user_id || !loser_user_id || (winner_user_id === loser_user_id)) {
        return res.status(400).json({ error: 'Invalid winner or loser' })
      }
    }
  }

  try {
    // controolo esistenza gioco
    const [grows] = await pool.query('SELECT id FROM games WHERE id = ?', [game_id])
    if (!grows.length) return res.status(404).json({ error: 'Game not found' })

    if (draw) {
      const players = (playersArr && playersArr.length > 0)
        ? Array.from(new Set(playersArr))
        : [winner_user_id, loser_user_id].filter(Boolean).map(Number).filter(Number.isFinite)

      if (!players.length) return res.status(400).json({ error: 'Missing players for draw' })

      for (const userId of players) {
        // aggiorno statistiche pareggio == piu veloce di un select + update
        // on duplicate controlla se esiste gia la riga per quell'utente e gioco
        await pool.query(
          `INSERT INTO user_game_stats (user_id, game_id, wins, losses, draw)
           VALUES (?, ?, 0, 0, 1)
           ON DUPLICATE KEY UPDATE draw = draw + 1`,
          [userId, game_id]
        )
      }

      return res.json({ saved: true, is_draw: true })
    }

    // Multiplayer arrays mode
    const usingArrays = Array.isArray(winnersArr) && winnersArr.length > 0 && Array.isArray(losersArr) && losersArr.length > 0
    if (usingArrays) {
      const winners = Array.from(new Set(winnersArr))
      const losers = Array.from(new Set(losersArr))

      // basic sanity: no overlap
      for (const w of winners) {
        if (losers.includes(w)) {
          return res.status(400).json({ error: 'Winners and losers overlap' })
        }
      }

      for (const w of winners) {
        await pool.query(
          `INSERT INTO user_game_stats (user_id, game_id, wins, losses, draw)
           VALUES (?, ?, 1, 0, 0)
           ON DUPLICATE KEY UPDATE wins = wins + 1`,
          [w, game_id]
        )
      }

      for (const l of losers) {
        await pool.query(
          `INSERT INTO user_game_stats (user_id, game_id, wins, losses, draw)
           VALUES (?, ?, 0, 1, 0)
           ON DUPLICATE KEY UPDATE losses = losses + 1`,
          [l, game_id]
        )
      }

      return res.json({ saved: true, is_draw: false, multiplayer: true })
    }

    // Legacy 1v1 mode
    await pool.query(
      `INSERT INTO user_game_stats (user_id, game_id, wins, losses, draw)
       VALUES (?, ?, 1, 0, 0)
       ON DUPLICATE KEY UPDATE wins = wins + 1`,
      [winner_user_id, game_id]
    )

    // Loser
    await pool.query(
      `INSERT INTO user_game_stats (user_id, game_id, wins, losses, draw)
       VALUES (?, ?, 0, 1, 0)
       ON DUPLICATE KEY UPDATE losses = losses + 1`,
      [loser_user_id, game_id]
    )

    return res.json({ saved: true, is_draw: false })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server Error' })
  }
})

router.get('/games', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name, min_players, max_players,icon, description FROM games')
    res.json({ games: rows })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database Error' })
  }
})

module.exports = router
