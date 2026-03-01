import React, { use, useState } from 'react'

export default function AuthModal({ open, onClose, onAuth }) {
  const [isRegister, setIsRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)


  if (!open) return null



  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { API_BASE_URL } = await import('../config')
      const endpoint = isRegister ? `${API_BASE_URL}/api/auth/register` : `${API_BASE_URL}/api/auth/login` 
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error || 'Auth failed')
      onAuth(data.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleKeyDown(e) {
  console.log('Tasto premuto:', e.key);
  if (e.key === '1' || e.key === '2') {
    setLoading(true);
    setError(null);

    const email =
      e.key === '1' ? 'test@test' : 'test2@test';

    try {
      const { API_BASE_URL } = await import('../config');
      const endpoint = `${API_BASE_URL}/api/auth/login`;

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'test',
          username
        }),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Auth failed');

      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }
}


  return (
    <div className="auth-modal" role="dialog" aria-modal="true">
      <div className="auth-backdrop" onClick={onClose} />
      <div className="auth-panel">
        <button className="close" onClick={onClose} aria-label="Close">×</button>
        <h3>{isRegister ? 'Register' : 'Login'}</h3>
        <button type="button" className="btn-play" onClick={() => handleKeyDown({ key: '1' })}>Play as User 1</button>
        <button type="button" className="btn-play" onClick={() => handleKeyDown({ key: '2' })}>Play as User 2</button>
        <form onSubmit={submit} className="auth-form">
          {isRegister && (
            <label>
              Name
              <input value={username} onChange={(e) => setName(e.target.value)} required />
            </label>
          )}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && <div style={{ color: 'salmon' }}>{error}</div>}
          <div className="auth-actions">
            <button type="submit" className="btn-play" disabled={loading}>{loading ? '...' : (isRegister ? 'Create account' : 'Login')}</button>
            <button type="button" className="nav-link" onClick={() => setIsRegister((s) => !s)}>
              {isRegister ? 'Have an account? Login' : "Don't have an account? Register"}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
