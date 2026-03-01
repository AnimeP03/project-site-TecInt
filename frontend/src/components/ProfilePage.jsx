import React, { useEffect, useState } from 'react'
import { API_BASE_URL } from '../config'

export default function ProfilePage({ user, onBack }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return

    async function fetchStats() {
      setLoading(true)
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/profile/${user.id}`)
        const data = await res.json()
        if (res.ok) {
          setStats(data)
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [user])

  const memberSince = user?.created_at 
    ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Unknown'

  const totalGames = stats?.totalGames || 0
  const wins = stats?.wins || 0
  const losses = stats?.losses || 0
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0

  return (
    <div className="profile-page">
      <button className="back-btn" onClick={onBack}>
        ← Back to Games
      </button>

      <div className="profile-card">
        <div className="profile-header">
          <div className="profile-avatar">👤</div>
          <div className="profile-info">
            <h1 className="profile-username">{user?.username}</h1>
            <span className="profile-email">{user?.email}</span>
            <span className="profile-joined">Member since {memberSince}</span>
          </div>
        </div>
      </div>

      <div className="stats-card">
        <h2 className="section-title">📊 Statistics</h2>
        
        {loading ? (
          <div className="stats-loading">Loading stats...</div>
        ) : (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-value">{totalGames}</span>
                <span className="stat-label">Games Played</span>
              </div>
              <div className="stat-card wins">
                <span className="stat-value">{wins}</span>
                <span className="stat-label">Wins</span>
              </div>
              <div className="stat-card losses">
                <span className="stat-value">{losses}</span>
                <span className="stat-label">Losses</span>
              </div>
              <div className="stat-card winrate">
                <span className="stat-value">{winRate}%</span>
                <span className="stat-label">Win Rate</span>
              </div>
            </div>

            {stats?.gameStats && stats.gameStats.length > 0 && (
              <div className="game-stats-section">
                <h3 className="subsection-title">Performance by Game</h3>
                <div className="game-stats-list">
                  {stats.gameStats.map(g => (
                    <div key={g.game_id} className="game-stat-row">
                      <span className="game-stat-name">{g.icon} {g.game_name}</span>
                      <div className="game-stat-bar">
                        <div 
                          className="bar-wins" 
                          style={{ width: `${g.total > 0 ? (g.wins / g.total) * 100 : 0}%` }}
                        />
                      </div>
                      <span className="game-stat-detail">
                        <span className="wins">{g.wins}W</span>
                        <span className="sep">/</span>
                        <span className="losses">{g.losses}L</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!stats?.gameStats || stats.gameStats.length === 0) && (
              <div className="no-stats">
                <div className="no-stats-icon">🎮</div>
                <p>No games played yet</p>
                <span>Join a lobby and start playing to see your stats!</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
