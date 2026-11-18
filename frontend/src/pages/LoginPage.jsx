import React from 'react'
import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { message } from 'antd'
import { useAuthStore } from '../stores/authStore'
import { authAPI } from '../services/api'
import './AuthPages.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setAuth } = useAuthStore()

  const [username, setUsername] = useState(location.state?.username || '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    if (location.state?.username) {
      setUsername(location.state.username)
    }
  }, [location.state])

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    setErrorMsg('')

    if (!username.trim() || !password) {
      setErrorMsg('Please enter both username and password.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.login({ username: username.trim(), password })
      const { access_token, user } = res.data
      setAuth(user, access_token)
      message.success('Logged in successfully')
      navigate('/')
    } catch (err) {
      if (err.response?.status === 402) {
        setErrorMsg('License required. Please activate your perpetual license.')
      } else {
        setErrorMsg(err.response?.data?.detail || 'Invalid username or password.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-wrapper">
      {/* Top Security Status */}
      <div className="auth-header-row">
        <div className="auth-badge">
          <div className="auth-pulse" />
          <span>Enterprise Security Node &bull; Zero-Trust Active</span>
        </div>
      </div>

      {/* Main Centered Auth Card */}
      <div className="auth-card">
        {/* Branding */}
        <div className="auth-brand-center">
          <img
            className="auth-logo"
            src="/ayal-hpc-logo.png"
            alt="AYAL HPC"
            onError={(e) => {
              e.currentTarget.src = '/logo.png'
            }}
          />
          <p className="auth-subtitle">High Performance Computing Management Platform</p>
        </div>

        {/* Tag Row */}
        <div className="auth-tag-row">
          <span className="auth-tag">SECURE ACCESS</span>
          <span className="auth-step-label">ADMINISTRATOR PORTAL</span>
        </div>

        <h2>Sign In</h2>
        <p className="auth-desc">Enter your credentials to access the cluster orchestration dashboard.</p>

        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="auth-input"
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setErrorMsg('')
              }}
              autoFocus={!username}
              required
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="login-password">Password</label>
            <div className="auth-input-wrap">
              <input
                id="login-password"
                className="auth-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErrorMsg('')
                }}
                autoFocus={!!username}
                required
              />
              <button
                type="button"
                className="auth-toggle-pwd"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'HIDE' : 'SHOW'}
              </button>
            </div>
          </div>

          <div className="auth-meta-row">
            <a className="auth-link" onClick={() => navigate('/forgot-password')}>
              Forgot password or username?
            </a>
          </div>

          {errorMsg && <div className="auth-notice error">{errorMsg}</div>}

          <div style={{ marginTop: 20 }}>
            <button type="submit" className="auth-btn-primary" disabled={loading}>
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>

      {/* Footer */}
      <footer className="auth-footer">
        AYAL HPC Management Platform &copy; 2026 AYAL. All rights reserved.
      </footer>
    </div>
  )
}
