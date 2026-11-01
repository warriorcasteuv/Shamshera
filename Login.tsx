import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSherabet } from './store'
import type { AccountProfile } from './types'

type SupabaseUser = {
  id: string
  email?: string
  user_metadata?: { full_name?: string }
  app_metadata?: { role?: string }
}
type SupabaseSession = { access_token: string; user: SupabaseUser }

const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const resolvedBaseUrl = baseUrl && baseUrl !== 'SUPABASE_URL' ? baseUrl : 'https://thcpbgpquhpvhrdlbulw.supabase.co'
const resolvedAnonKey = anonKey && anonKey !== 'SUPABASE_PUBLISHABLE_KEY'
  ? anonKey
  : 'sb_publishable_FJOYI42sEoEZdHlj_o4qnA_dbmDLrkx'
const sessionKey = 'lasersport-supabase-session'

function configured() {
  if (!resolvedBaseUrl || !resolvedAnonKey) throw new Error('Login is not configured yet. Please contact support.')
}

async function auth(path: string, init: RequestInit = {}, token?: string) {
  configured()
  const response = await fetch(resolvedBaseUrl + path, {
    ...init,
    headers: {
      apikey: resolvedAnonKey,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = await response.json().catch(() => ({})) as { msg?: string; error_description?: string; message?: string }
  if (!response.ok) throw new Error(body.msg ?? body.error_description ?? body.message ?? 'Could not authenticate. Please try again.')
  return body
}

function profile(user: SupabaseUser): AccountProfile {
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

function saveSession(session: SupabaseSession) {
  localStorage.setItem(sessionKey, JSON.stringify(session))
}

export function Login() {
  const user = useSherabet((s) => s.user)
  const setServerProfile = useSherabet((s) => s.setServerProfile)
  const [mode, setMode] = useState<'login' | 'signup' | 'recover' | 'reset'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  if (user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    setMessageIsError(false)
    try {
      if (mode === 'recover') {
        const response = await fetch('/api/auth/password-reset/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const result = await response.json().catch(() => ({})) as { error?: string; message?: string }
        if (!response.ok) throw new Error(result.error ?? 'Could not send the reset code.')
        setResetCode('')
        setMode('reset')
        setMessage(result.message ?? 'A password-reset code has been sent to your email.')
        return
      }
      if (mode === 'reset') {
        if (password !== confirmPassword) throw new Error('The passwords do not match.')
        const response = await fetch('/api/auth/password-reset/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code: resetCode, password }),
        })
        const result = await response.json().catch(() => ({})) as { error?: string; message?: string }
        if (!response.ok) throw new Error(result.error ?? 'The reset code is invalid or has expired.')
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setResetCode('')
        setMessage(result.message ?? 'Password updated. You can now sign in.')
        return
      }
      if (mode === 'signup') {
        if (password !== confirmPassword) throw new Error('The passwords do not match.')
        const result = await auth('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password, data: { full_name: name } }) }) as { user?: SupabaseUser; access_token?: string }
        if (!result.access_token || !result.user) {
          setMessage('Check your email to confirm your account, then sign in.')
          return
        }
        const session = { access_token: result.access_token, user: result.user }
        saveSession(session)
        setServerProfile(profile(result.user))
        navigate('/')
        return
      }
      const result = await auth('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) }) as SupabaseSession
      if (!result.access_token || !result.user) throw new Error('Could not sign in. Please try again.')
      saveSession(result)
      setServerProfile(profile(result.user))
      navigate('/')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the login service.')
      setMessageIsError(true)
    } finally {
      setSubmitting(false)
    }
  }

  const heading = mode === 'signup' ? 'Create account' : mode === 'recover' ? 'Reset password' : mode === 'reset' ? 'Choose a new password' : 'LaserSport'
  return <div className="login"><form className="login-card" onSubmit={onSubmit}>
    {mode === 'login' && <div className="login-switch" aria-label="Login type switch"><span className="login-switch-option active">Customer</span><button type="button" className="login-switch-link" onClick={() => navigate('/admin-login')}>Admin login</button></div>}
    <span className="credits-chip">Customer account</span>
    <h1>{heading}</h1>
    {mode === 'recover' && <p>Enter your email and we will send a 6-digit password-reset code.</p>}
    {mode === 'reset' && <p>Enter the code from your email, then choose a new password.</p>}
    {mode === 'reset' && <label className="auth-field">6-digit reset code<input value={resetCode} onChange={(event) => setResetCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} pattern="[0-9]{6}" required /></label>}
    {mode === 'signup' && <label className="auth-field">Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={48} /></label>}
    {(mode === 'login' || mode === 'signup' || mode === 'recover') && <label className="auth-field">Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>}
    {(mode === 'login' || mode === 'signup' || mode === 'reset') && <label className="auth-field">{mode === 'reset' ? 'New password' : 'Password'}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>}
    {(mode === 'signup' || mode === 'reset') && <label className="auth-field">Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>}
    {message && <p className={'flash' + (messageIsError ? ' error' : '')} role="status">{message}</p>}
    {mode === 'login' && <button type="button" className="alt-link" onClick={() => { setMode('recover'); setMessage('') }}>Forgot password?</button>}
    <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'recover' ? 'Send reset code' : mode === 'reset' ? 'Update password' : 'Sign in'}</button>
    {mode !== 'reset' && <p className="auth-switch-copy">{mode === 'signup' ? 'Already have an account?' : mode === 'recover' ? 'Remembered it?' : 'New here?'} <button type="button" className="login-switch-link" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage('') }}>{mode === 'signup' ? 'Sign in' : 'Sign up'}</button></p>}
  </form></div>
}

export function AdminLogin() {
  const setServerProfile = useSherabet((s) => s.setServerProfile)
  const [designation, setDesignation] = useState<'main_admin' | 'ceo' | 'manager' | 'employee'>('main_admin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [activationCode, setActivationCode] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const url = designation === 'main_admin' ? '/api/admin/login' : '/api/staff/login'
      const body = designation === 'main_admin'
        ? { username, password }
        : { role: designation, employeeId, activationCode }
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await response.json().catch(() => ({})) as AccountProfile & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'The admin login was rejected.')
      if (!result.playerId || !result.role) throw new Error('Could not sign in. Please try again.')
      setServerProfile(result)
      navigate('/admin')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the login service.')
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="login"><form className="login-card admin-login-card" onSubmit={onSubmit}>
    <span className="credits-chip">Admin desk</span>
    <h1>Admin Login</h1>
    <label className="auth-field">Designation<select value={designation} onChange={(event) => { setDesignation(event.target.value as typeof designation); setMessage('') }}>
      <option value="main_admin">Main Admin</option>
      <option value="ceo">CEO</option>
      <option value="manager">Manager</option>
      <option value="employee">Employee</option>
    </select></label>
    {designation === 'main_admin' ? <>
      <label className="auth-field">Admin username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required /></label>
      <label className="auth-field">Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
    </> : <>
      <label className="auth-field">Employee ID<input value={employeeId} onChange={(event) => setEmployeeId(event.target.value.toUpperCase())} autoComplete="username" required /></label>
      <label className="auth-field">Activation code<input value={activationCode} onChange={(event) => setActivationCode(event.target.value.toUpperCase())} autoComplete="one-time-code" required /></label>
    </>}
    {message && <p className="flash error" role="status">{message}</p>}
    <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : 'Enter Admin Desk'}</button>
    <p className="auth-switch-copy"><button type="button" className="login-switch-link" onClick={() => navigate('/login')}>Customer login</button></p>
  </form></div>
}
