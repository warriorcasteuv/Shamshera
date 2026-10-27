import { useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { SPORTS } from './catalog'
import { formatVc } from './money'
import { useSherabet } from './store'
import { BetSlip } from './Betslip'
import type { AccountProfile } from './types'

type StoredSession = { access_token: string; user: { id: string; email?: string; user_metadata?: { full_name?: string } } }
const sessionKey = 'lasersport-supabase-session'

function profile(session: StoredSession): AccountProfile {
  const user = session.user
  return {
    playerId: user.id,
    user: user.user_metadata?.full_name?.trim() || user.email?.split('@')[0] || 'Player',
    balance: 0,
    role: 'customer',
    isUnlimited: false,
    employeeId: null,
    staffStatus: null,
    permissions: {},
  }
}

export function Layout() {
  const user = useSherabet((s) => s.user)
  const balance = useSherabet((s) => s.balance)
  const role = useSherabet((s) => s.role)
  const authReady = useSherabet((s) => s.authReady)
  const setServerProfile = useSherabet((s) => s.setServerProfile)
  const clearSession = useSherabet((s) => s.clearSession)
  const logout = useSherabet((s) => s.logout)
  const tickOdds = useSherabet((s) => s.tickOdds)
  const location = useLocation()
  const navigate = useNavigate()
  const isAdminPage = location.pathname === '/admin'
  const isCeo = role === 'ceo'
  const hideMyBets = isAdminPage || role === 'main_admin' || isCeo

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sessionKey)
      if (!raw) throw new Error('Not signed in')
      const session = JSON.parse(raw) as StoredSession
      if (!session.access_token || !session.user?.id) throw new Error('Invalid session')
      setServerProfile(profile(session))
    } catch {
      localStorage.removeItem(sessionKey)
      clearSession()
    }
  }, [setServerProfile, clearSession])

  useEffect(() => {
    if (authReady && !user) navigate('/login', { replace: true })
  }, [authReady, user, navigate])

  useEffect(() => {
    const id = window.setInterval(tickOdds, 2800)
    return () => window.clearInterval(id)
  }, [tickOdds])

  if (!authReady || !user) return null
  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">LS</div><div><h1>LaserSport</h1><small>Sports exchange</small></div><span className="credits-chip">Coins</span></div>
      <div className="top-actions">
        <div className="balance-pill"><span>Coin balance</span><strong>{role === 'main_admin' ? 'Unlimited coins' : `${formatVc(balance)} coins`}</strong></div>
        {!hideMyBets && <NavLink className="ghost" to="/bets">My bets</NavLink>}
        <NavLink className="ghost" to="/account">Coins</NavLink>
        <NavLink className="ghost" to="/admin">Admin</NavLink>
        <button className="ghost" type="button" onClick={() => { localStorage.removeItem(sessionKey); logout(); navigate('/login') }}>Sign out</button>
      </div>
    </header>
    <p className="notice">Coin requests and uploaded images are stored only in this browser. No payment is processed.</p>
    <div className="workspace">
      <aside className="sidebar"><div className="nav-title">Markets</div><NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/" end>In-play <em>Live</em></NavLink>{SPORTS.map((sport) => <NavLink key={sport.id} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to={`/sport/${sport.id}`}>{sport.label} <em>{sport.hint}</em></NavLink>)}<NavLink className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`} to="/casino">Casino <em>Games</em></NavLink></aside>
      <main className="main"><Outlet /></main><BetSlip />
    </div>
  </div>
}
