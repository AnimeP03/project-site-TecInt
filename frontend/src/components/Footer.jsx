import React from 'react'

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <div>© {new Date().getFullYear()} GameHub by Arama Daniel</div>
        <div className="links">Made with ❤️</div>
      </div>
    </footer>
  )
}
