import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useSherabet } from './store'
import type { AccountProfile } from './types'

export function Login() {
  const user = useSherabet((s) => s.user)
  const setServerProfile = useSherabet((s) => s.setServerProfile)
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [flow, setFlow] = useState<'account' | 'request-reset' | 'complete-reset'>('account')
  const [method, setMethod] = useState<'email' | 'mobile'>('email')
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const navigate = useNavigate()
  if (user) return <Navigate to="/" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage('')
    setMessageIsError(false)
    try {
      if (flow === 'request-reset') {
        const response = await fetch('/api/auth/password-reset/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier }),
        })
        const result = await response.json() as { message?: string; error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Could not send a reset code. Try again.')
        setFlow('complete-reset')
        setMessage(result.message ?? 'If an account uses that email, a password reset code has been sent.')
        return
      }
      if (flow === 'complete-reset') {
        if (!/^\d{6}$/.test(resetCode)) throw new Error('Enter the 6-digit reset code from your email.')
        if (password !== confirmPassword) throw new Error('The passwords do not match.')
        const response = await fetch('/api/auth/password-reset/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: identifier, code: resetCode, password }),
        })
        const result = await response.json() as { message?: string; error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Could not reset the password. Request a new code.')
        setFlow('account')
        setMode('login')
        setPassword('')
        setConfirmPassword('')
        setResetCode('')
        setMessage(result.message ?? 'Password updated. Sign in with your new password.')
        return
      }
      const response = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ method, identifier, password, ...(mode === 'signup' ? { name } : {}) }),
      })
      const result = await response.json() as AccountProfile & { error?: string }
      if (!response.ok || !result.user) throw new Error(result.error ?? 'Could not authenticate. Try again.')
      setServerProfile(result)
      navigate('/')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the login service.')
      setMessageIsError(true)
    } finally {
      setSubmitting(false)
    }
  }
  return (
    <div className="login">
      <form className="login-card" onSubmit={onSubmit}>
        {flow === 'account' && <>
          <div className="login-switch" aria-label="Login type switch">
            <span className="login-switch-option active">Customer</span>
            <button type="button" className="login-switch-link" onClick={() => navigate('/admin-login')}>Admin login</button>
          </div>
          <span className="credits-chip">Customer account</span>
        </>}
        <h1>{flow === 'request-reset' ? 'Reset password' : flow === 'complete-reset' ? 'Choose a new password' : mode === 'signup' ? 'Create account' : 'Orixbet'}</h1>
        {flow === 'request-reset' && <p>Enter the email address on your account and we’ll send a 6-digit reset code.</p>}
        {flow === 'complete-reset' && <p>Enter the code sent to {identifier} and choose a new password.</p>}
        {flow === 'account' && mode === 'signup' && <label className="auth-field">Full name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required minLength={2} maxLength={48} /></label>}
        {flow === 'account' && <div className="contact-switch" aria-label="Sign in with">
          <button className={method === 'email' ? 'active' : ''} type="button" onClick={() => { setMethod('email'); setIdentifier('') }}>Email</button>
          <button className={method === 'mobile' ? 'active' : ''} type="button" onClick={() => { setMethod('mobile'); setIdentifier('') }}>Mobile</button>
        </div>}
        {(flow === 'request-reset' || flow === 'account') && <label className="auth-field">{flow === 'request-reset' || method === 'email' ? 'Email address' : 'Mobile number'}<input
          type={flow === 'request-reset' || method === 'email' ? 'email' : 'tel'}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder={flow === 'request-reset' || method === 'email' ? 'you@example.com' : '+91 98765 43210'}
          autoComplete={flow === 'request-reset' ? 'email' : mode === 'signup' ? (method === 'email' ? 'email' : 'tel') : 'username'}
          required
        /></label>}
        {flow === 'complete-reset' && <label className="auth-field">6-digit reset code<input
          inputMode="numeric"
          autoComplete="one-time-code"
          value={resetCode}
          onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="000000"
          minLength={6}
          maxLength={6}
          required
        /></label>}
        {(flow === 'account' || flow === 'complete-reset') && <label className="auth-field">{flow === 'complete-reset' ? 'New password' : 'Password'}<input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={flow === 'complete-reset' || mode === 'signup' ? 'new-password' : 'current-password'}
          minLength={flow === 'complete-reset' || mode === 'signup' ? 8 : undefined}
          maxLength={128}
          required
        /></label>}
        {flow === 'complete-reset' && <label className="auth-field">Confirm new password<input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        /></label>}
        {flow === 'account' && mode === 'login' && method === 'email' && <button
          type="button"
          className="alt-link"
          onClick={() => { setFlow('request-reset'); setMessage(''); setMessageIsError(false) }}
        >Forgot password?</button>}
        {message && <p className={`flash${messageIsError ? ' error' : ''}`} role="status">{message}</p>}
        <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : flow === 'request-reset' ? 'Send reset code' : flow === 'complete-reset' ? 'Verify code & update password' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
        {flow === 'complete-reset' && <p className="auth-switch-copy">Need another code? <button type="button" className="login-switch-link" onClick={() => {
          setFlow('request-reset')
          setResetCode('')
          setMessage('')
          setMessageIsError(false)
        }}>Send again</button></p>}
        {flow !== 'complete-reset' && <p className="auth-switch-copy">{flow === 'request-reset' ? 'Remembered it?' : mode === 'signup' ? 'Already have an account?' : 'New here?'} <button type="button" className="login-switch-link" onClick={() => {
          setMessage('')
          setMessageIsError(false)
          if (flow === 'request-reset') setFlow('account')
          else setMode(mode === 'signup' ? 'login' : 'signup')
        }}>{flow === 'request-reset' ? 'Sign in' : mode === 'signup' ? 'Sign in' : 'Sign up'}</button></p>}
      </form>
    </div>
  )
}

export function AdminLogin() {
  const navigate = useNavigate()
  const setServerProfile = useSherabet((s) => s.setServerProfile)
  const [mode, setMode] = useState<'admin' | 'staff'>('admin')
  const [username, setUsername] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [password, setPassword] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [activationCode, setActivationCode] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const response = await fetch(mode === 'admin' ? '/api/admin/login' : '/api/staff/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'admin'
          ? { username, password }
          : { employeeId, activationCode }),
      })
      const result = await response.json() as AccountProfile & { error?: string }
      if (!response.ok || !result.user || !result.playerId) {
        throw new Error(result.error ?? 'Could not sign in to the staff account.')
      }
      setServerProfile(result)
      navigate('/admin')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not connect to the login service.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login">
      <form className="login-card admin-login-card" onSubmit={onSubmit}>
        <div className="login-switch" aria-label="Login type switch">
          <button type="button" className="login-switch-link" onClick={() => navigate('/login')}>Customer Login</button>
          <button type="button" className={`login-switch-link${mode === 'admin' ? ' active' : ''}`} onClick={() => { setMode('admin'); setMessage('') }}>Main admin</button>
          <button type="button" className={`login-switch-link${mode === 'staff' ? ' active' : ''}`} onClick={() => { setMode('staff'); setMessage('') }}>Team member</button>
        </div>
        <span className="credits-chip">{mode === 'admin' ? 'Main admin' : 'Staff account'}</span>
        <h1>{mode === 'admin' ? 'Admin Login' : 'Team Login'}</h1>
        <p>{mode === 'admin' ? 'Sign in with the credentials configured on the server.' : 'Use the employee ID and private activation code from your invitation.'}</p>
        {mode === 'admin' ? <>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Admin username" required aria-label="Admin username" autoComplete="username" />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Admin password" required aria-label="Admin password" autoComplete="current-password" />
        </> : <>
          <input value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="Employee ID" required aria-label="Employee ID" autoComplete="username" />
          <input type="password" value={activationCode} onChange={(e) => setActivationCode(e.target.value)} placeholder="Activation code" required aria-label="Activation code" autoComplete="current-password" />
        </>}
        {message && <p className="flash error" role="status">{message}</p>}
        <button className="primary" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : mode === 'admin' ? 'Enter Admin Desk' : 'Sign in to team account'}</button>
      </form>
    </div>
  )
}
