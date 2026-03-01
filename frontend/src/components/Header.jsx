import React, { useState } from 'react'

export default function Header({ user, onLoginClick, onLogout, onHomeClick, onProfileClick }) {
  const [openUserMenu, setOpenUserMenu] = useState(false)

  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="brand">
          <h1>🎮 GameHub</h1>
        </div>
        <nav className="nav">
          <a href="#" className="nav-link active" onClick={(e) => { e.preventDefault(); onHomeClick?.() }}>Home</a>

          {!user && (
            <button className="nav-link" onClick={() => {onLoginClick?.() }}>Login</button>
          )}

          {user && (
            <div style={{ position: 'relative' }}>
              <button className="nav-link user" onClick={() => setOpenUserMenu((s) => !s)}>👤 {user.username}</button>
              {openUserMenu && (
                <div className="user-menu">
                  <button className="nav-link" onClick={() => { onProfileClick?.(); setOpenUserMenu(false) }}>Profile</button>
                  <button className="nav-link" onClick={() => { onLogout?.(); setOpenUserMenu(false) }}>Logout</button>
                </div>
              )}
            </div>
          )}
        </nav>
      </div>
    </header>
  )
}
