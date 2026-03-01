const express = require('express')
const bcrypt = require('bcrypt')
const pool = require('../db')

const router = express.Router()

//register new user
router.post('/register', async (req, res) => {
  const { email, password, username } = req.body
  if (!email || !password || !username) return res.status(400).json({ error: 'Data Required' })

  try {
    const [rows] = await pool.query('SELECT id FROM users WHERE email = ?', [email])
    if (rows.length) return res.status(409).json({ error: 'Email already in use' })

    const hash = await bcrypt.hash(password, 10)
    const [result] = await pool.query('INSERT INTO users (email, password, username) VALUES (?, ?, ?)', [email, hash, username])
    const [userRows] = await pool.query('SELECT id, email, username FROM users WHERE id = ?', [result.insertId])
    res.status(201).json({ user: userRows[0] })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Database Error' })
  }
})

//login existing user
router.post('/login', async (req, res) => {
  const { email, password } = req.body
  /*const credentials = { email: "test@test", password: "test" };
  const { email, password } = credentials;*/
  if (!email || !password) return res.status(400).json({ error: 'Data required' })

  try {
    const [rows] = await pool.query('SELECT id, email, username, password, created_at FROM users WHERE email = ?', [email])
    if (!rows.length) return res.status(401).json({ error: 'Invalid Credentials' })

    const ok = await bcrypt.compare(password, rows[0].password)
    if (!ok) return res.status(401).json({ error: 'Invalid Credentials' })
    
    // Don't send password hash to frontend
    const { password: _, ...userWithoutPassword } = rows[0]
    res.status(201).json({ user: userWithoutPassword })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'server error' })
  }
})

// Get user profile with stats
router.get('/profile/:id', async (req, res) => {
  const userId = req.params.id

  try {
    // Get user info
    const [userRows] = await pool.query(
      'SELECT id, email, username, created_at FROM users WHERE id = ?',
      [userId]
    )
    if (!userRows.length) return res.status(404).json({ error: 'User not found' })

    // Get overall stats from user_game_stats if it exists
    const [overallStats] = await pool.query(
      `SELECT 
        COALESCE(SUM(wins), 0) as wins,
        COALESCE(SUM(losses), 0) as losses,
        COALESCE(SUM(wins + losses), 0) as totalGames
       FROM user_game_stats WHERE user_id = ?`,
      [userId]
    )

    // Get per-game stats
    const [gameStats] = await pool.query(
      `SELECT 
        ugs.game_id,
        g.name as game_name,
        g.icon,
        ugs.wins,
        ugs.losses,
        (ugs.wins + ugs.losses) as total
       FROM user_game_stats ugs
       JOIN games g ON ugs.game_id = g.id
       WHERE ugs.user_id = ?
       ORDER BY total DESC`,
      [userId]
    )

    res.json({
      user: userRows[0],
      wins: overallStats[0]?.wins || 0,
      losses: overallStats[0]?.losses || 0,
      totalGames: overallStats[0]?.totalGames || 0,
      gameStats
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Server Error' })
  }
})


module.exports = router
