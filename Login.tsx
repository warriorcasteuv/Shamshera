import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSherabet } from './store'
import type { AccountProfile } from './types'

type SupabaseUser = { id: string; email?: string; user_metadata?: { full_name?: string } }
type SupabaseSession = { access_token: string; user: SupabaseUser }

const baseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const sessionKey = 'lasersport-supabase-session'

function configured() {
  if (!baseUrl || !anonKey) throw new Error('Login is not configured yet. Please contact support.')
}

async function auth(path: string, init: RequestInit = {}, token?: string) {
  configured()
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      apikey: anonKey!,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('access_token')
    if (token) setMode('reset')
  }, [])

  if (user) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    setMessageIsError(false)
    try {
      if (mode === 'recover') {
        await auth('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email, options: { redirectTo: `${window.location.origin}/login` } }) })
        setMessage('If an account uses that email, a password-reset link has been sent.')
        return
      }
      if (mode === 'reset') {
        if (password !== confirmPassword) throw new Error('The passwords do not match.')
        const token = new URLSearchParams(window.location.hash.slice(1)).get('access_token')
        if (!token) throw new Error('This password-reset link is invalid or has expired.')
        await auth('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password }) }, token)
        window.location.hash = ''
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setMessage('Password updated. You can now sign in.')
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
    <span className="credits-chip">Customer account</span>
    <h1>{heading}</h1>
    {mode === 'recover' && <p>Enter your email and we will send a password-reset link.</p>}
    {mode === 'reset' && <p>Choose a new password for your account.</p>}
    {mode === 'signup' && <label className="auth-field">Full name<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={48} /></label>}
    {(mode === 'login' || mode === 'signup' || mode === 'recover') && <label className="auth-field">Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required /></label>}
    {(mode === 'login' || mode === 'signup' || mode === 'reset') && <label className="auth-field">{mode === 'reset' ? 'New password' : 'Password'}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required /></label>}
    {(mode === 'signup' || mode === 'reset') && <label className="auth-field">Confirm password<input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={8} required /></label>}
    {message && <p className={`flash${messageIsError ? ' error' : ''}`} role="status">{message}</p>}
    {mode === 'login' && <button type="button" className="alt-link" onClick={() => { setMode('recover'); setMessage('') }}>Forgot password?</button>}
    <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'signup' ? 'Create account' : mode === 'recover' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'}</button>
    {mode !== 'reset' && <p className="auth-switch-copy">{mode === 'signup' ? 'Already have an account?' : mode === 'recover' ? 'Remembered it?' : 'New here?'} <button type="button" className="login-switch-link" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setMessage('') }}>{mode === 'signup' ? 'Sign in' : 'Sign up'}</button></p>}
  </form></div>
}

export function AdminLogin() {
  const navigate = useNavigate()
  return <div className="login"><div className="login-card"><span className="credits-chip">Admin</span><h1>Admin login</h1><p>Admin accounts remain on the existing private backend and are not available on the public Vercel site.</p><button className="primary" type="button" onClick={() => navigate('/login')}>Customer login</button></div></div>
}
