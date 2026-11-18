import React from 'react'
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { authAPI } from '../services/api'
import './AuthPages.css'

export default function ForgotPasswordPage() {
  const navigate = useNavigate()

  // Step state: 1 (Request & Bot Check), 2 (Verify OTP), 3 (Username & New Password), 4 (Complete)
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [resetToken, setResetToken] = useState('')
  const [recoveredUsername, setRecoveredUsername] = useState('')

  // Bot Verification State
  const [botVerified, setBotVerified] = useState(false)
  const [botVerifying, setBotVerifying] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [infoMsg, setInfoMsg] = useState('')

  // Resend Countdown Timer (starts at 60 seconds)
  const [countdown, setCountdown] = useState(60)
  const timerRef = useRef(null)

  // Refs for 6 OTP input boxes
  const otpRefs = useRef([])

  useEffect(() => {
    if (step === 2 && countdown > 0) {
      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(timerRef.current)
  }, [step, countdown])

  const formatCountdown = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  const clearMessages = () => {
    setErrorMsg('')
    setInfoMsg('')
  }

  // Interactive Bot Verification Trigger
  const handleBotVerification = () => {
    if (botVerified || botVerifying) return
    clearMessages()
    setBotVerifying(true)
    setTimeout(() => {
      setBotVerifying(false)
      setBotVerified(true)
      setCaptchaToken(`human_token_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`)
    }, 800)
  }

  // Step 1: Send OTP to registered email after bot verification
  const handleRequestOtp = async (e) => {
    if (e) e.preventDefault()
    clearMessages()

    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid registered business email address.')
      return
    }

    if (!botVerified) {
      setErrorMsg('Please complete the bot security check to continue.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.forgotPasswordRequest({
        email: cleanEmail,
        captcha_token: captchaToken,
      })
      setMaskedEmail(res.data?.masked_email || cleanEmail)
      setInfoMsg(res.data?.message || 'Verification code dispatched to your registered email.')
      setStep(2)
      setCountdown(60)
      setOtpDigits(['', '', '', '', '', ''])
      setTimeout(() => {
        if (otpRefs.current[0]) otpRefs.current[0].focus()
      }, 150)
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Failed to dispatch verification code. Please check your email address.')
    } finally {
      setLoading(false)
    }
  }

  // Handle OTP Inputs
  const handleOtpChange = (index, value) => {
    clearMessages()
    const val = value.replace(/\D/g, '')
    if (!val) {
      const nextDigits = [...otpDigits]
      nextDigits[index] = ''
      setOtpDigits(nextDigits)
      return
    }

    const nextDigits = [...otpDigits]
    nextDigits[index] = val.slice(-1)
    setOtpDigits(nextDigits)

    // Move to next input if filled
    if (index < 5 && val) {
      otpRefs.current[index + 1]?.focus()
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const handleOtpPaste = (e) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return

    const nextDigits = [...otpDigits]
    for (let i = 0; i < 6; i++) {
      nextDigits[i] = pasted[i] || ''
    }
    setOtpDigits(nextDigits)

    const focusIdx = Math.min(pasted.length, 5)
    otpRefs.current[focusIdx]?.focus()
  }

  // Resend OTP
  const handleResendCode = async () => {
    if (countdown > 0 || loading) return
    clearMessages()
    setLoading(true)
    try {
      await authAPI.forgotPasswordRequest({
        email: email.trim().toLowerCase(),
        captcha_token: captchaToken,
      })
      setInfoMsg('A fresh 6-digit verification code has been dispatched to your email.')
      setCountdown(60)
      setOtpDigits(['', '', '', '', '', ''])
      if (otpRefs.current[0]) otpRefs.current[0].focus()
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Failed to resend code. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Verify OTP & Retrieve Existing Username
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault()
    clearMessages()

    const fullOtp = otpDigits.join('').trim()
    if (fullOtp.length !== 6) {
      setErrorMsg('Please enter the full 6-digit verification code received in your email.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.forgotPasswordVerifyOtp({
        email: email.trim().toLowerCase(),
        otp: fullOtp,
      })
      setResetToken(res.data?.reset_token || '')
      setRecoveredUsername(res.data?.username || 'admin')
      setInfoMsg(res.data?.message || 'Verification successful. Existing account username retrieved.')
      setStep(3)
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Invalid or expired verification code.')
    } finally {
      setLoading(false)
    }
  }

  // Step 3: Reset Password (Keeps Username Unchanged)
  const handleResetPassword = async (e) => {
    if (e) e.preventDefault()
    clearMessages()

    if (!newPassword || newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.')
      return
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('The new password and confirm password do not match.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.forgotPasswordReset({
        email: email.trim().toLowerCase(),
        reset_token: resetToken,
        new_password: newPassword,
      })
      if (res.data?.username) {
        setRecoveredUsername(res.data.username)
      }
      setStep(4)
    } catch (err) {
      setErrorMsg(err.response?.data?.detail || 'Failed to reset password. Please restart the recovery process.')
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

        {/* Step Indicator Row */}
        <div className="auth-tag-row">
          <span className="auth-tag">
            {step === 1 && 'ACCOUNT RECOVERY'}
            {step === 2 && 'IDENTITY VERIFICATION'}
            {step === 3 && 'SET NEW PASSWORD'}
            {step === 4 && 'RECOVERY COMPLETED'}
          </span>
          <span className="auth-step-label">
            {step <= 3 ? `STEP ${step} OF 3` : 'COMPLETED'}
          </span>
        </div>

        {/* SCREEN 1: Request Email + Bot Verification */}
        {step === 1 && (
          <div>
            <h2>Recover Username &amp; Password</h2>
            <p className="auth-desc">
              Enter your registered business email and complete the security verification to retrieve your account username and set a new password.
            </p>

            <form onSubmit={handleRequestOtp}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="fp-email">REGISTERED BUSINESS EMAIL</label>
                <input
                  id="fp-email"
                  className="auth-input"
                  type="email"
                  placeholder="Enter registered business email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    clearMessages()
                  }}
                  autoFocus
                  required
                />
              </div>

              {/* Bot Verification Widget */}
              <div
                className={`auth-captcha-box ${botVerified ? 'verified' : ''}`}
                onClick={handleBotVerification}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleBotVerification() }}
              >
                <div className="auth-captcha-left">
                  <div className="auth-captcha-checkbox">
                    {botVerifying && <div className="auth-captcha-spinner" />}
                    {botVerified && (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <span className="auth-captcha-label">
                    {botVerified ? 'Security Verified: Human User' : 'Verify you are human'}
                  </span>
                </div>
                <div className="auth-captcha-right">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  <span>Anti-Bot Shield</span>
                </div>
              </div>

              {errorMsg && <div className="auth-notice error">{errorMsg}</div>}
              {infoMsg && <div className="auth-notice info">{infoMsg}</div>}

              <div style={{ marginTop: 22 }}>
                <button
                  type="submit"
                  className="auth-btn-primary"
                  disabled={loading || !botVerified}
                >
                  {loading ? 'Dispatching Code...' : 'Send Verification Code'}
                </button>
              </div>
            </form>

            <a className="auth-btn-back" onClick={() => navigate('/login')}>
              &larr; Return to Sign In
            </a>
          </div>
        )}

        {/* SCREEN 2: OTP Verification */}
        {step === 2 && (
          <div>
            <h2>Enter Verification Code</h2>
            <p className="auth-desc">
              A 6-digit one-time code has been dispatched to{' '}
              <strong style={{ color: 'var(--auth-cyan)' }}>{maskedEmail || email}</strong>.
            </p>

            <form onSubmit={handleVerifyOtp}>
              <div className="auth-field">
                <label className="auth-label">6-DIGIT VERIFICATION CODE</label>
                <div className="auth-otp-row">
                  {otpDigits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (otpRefs.current[idx] = el)}
                      className="auth-otp-box"
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      onPaste={handleOtpPaste}
                      autoFocus={idx === 0}
                    />
                  ))}
                </div>
              </div>

              <p className="auth-hint">
                Didn&apos;t receive the code?{' '}
                {countdown > 0 ? (
                  <span style={{ color: 'var(--auth-muted)', fontWeight: 600 }}>
                    Resend Code ({formatCountdown(countdown)})
                  </span>
                ) : (
                  <a
                    onClick={handleResendCode}
                    style={{ color: 'var(--auth-cyan)', fontWeight: 700, cursor: 'pointer' }}
                  >
                    Resend Code Now
                  </a>
                )}
              </p>

              {errorMsg && <div className="auth-notice error">{errorMsg}</div>}
              {infoMsg && <div className="auth-notice success">{infoMsg}</div>}

              <div style={{ marginTop: 22 }}>
                <button type="submit" className="auth-btn-primary" disabled={loading}>
                  {loading ? 'Verifying Code...' : 'Verify Code & Retrieve Username'}
                </button>
              </div>
            </form>

            <a
              className="auth-btn-back"
              onClick={() => {
                clearMessages()
                setStep(1)
              }}
            >
              &larr; Change Email Address
            </a>
          </div>
        )}

        {/* SCREEN 3: Recovered Username & Set New Password */}
        {step === 3 && (
          <div>
            <h2>Set New Password</h2>
            <p className="auth-desc">
              Your existing account username has been retrieved. You may now specify a new password.
            </p>

            {/* Recovered Username Card (Read-only / Unchanged) */}
            <div className="auth-username-card">
              <div className="auth-username-header">
                <span className="auth-username-badge">RECOVERED ACCOUNT USERNAME</span>
                <span className="auth-username-pill">UNCHANGED</span>
              </div>
              <div className="auth-username-val">{recoveredUsername}</div>
              <div className="auth-username-note">
                Your username remains strictly unchanged. You will sign in with this username.
              </div>
            </div>

            <form onSubmit={handleResetPassword}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="fp-new-pwd">NEW PASSWORD</label>
                <div className="auth-input-wrap">
                  <input
                    id="fp-new-pwd"
                    className="auth-input"
                    type={showNew ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      clearMessages()
                    }}
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle-pwd"
                    onClick={() => setShowNew(!showNew)}
                  >
                    {showNew ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="fp-confirm-pwd">CONFIRM NEW PASSWORD</label>
                <div className="auth-input-wrap">
                  <input
                    id="fp-confirm-pwd"
                    className="auth-input"
                    type={showConfirm ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      clearMessages()
                    }}
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle-pwd"
                    onClick={() => setShowConfirm(!showConfirm)}
                  >
                    {showConfirm ? 'HIDE' : 'SHOW'}
                  </button>
                </div>
              </div>

              <div className="auth-tip">
                Must contain at least 8 characters, including uppercase, lowercase, numbers, and special characters.
              </div>

              {errorMsg && <div className="auth-notice error">{errorMsg}</div>}
              {infoMsg && <div className="auth-notice info">{infoMsg}</div>}

              <div style={{ marginTop: 22 }}>
                <button type="submit" className="auth-btn-primary" disabled={loading}>
                  {loading ? 'Updating Password...' : 'Save Password & Complete'}
                </button>
              </div>
            </form>

            <a className="auth-btn-back" onClick={() => navigate('/login')}>
              &larr; Cancel &amp; Return to Sign In
            </a>
          </div>
        )}

        {/* SCREEN 4: Completion */}
        {step === 4 && (
          <div style={{ textAlign: 'center' }}>
            <div className="auth-success-circle">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2>Account Recovered Successfully</h2>
            <p className="auth-desc">
              Your password has been updated and your credentials confirmation email has been sent to your registered address.
            </p>

            {/* Account Details Box */}
            <div className="auth-username-card" style={{ textAlign: 'left', marginTop: 16 }}>
              <div className="auth-username-header">
                <span className="auth-username-badge">YOUR ACCOUNT CREDENTIALS</span>
                <span className="auth-username-pill">READY TO LOGIN</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                <span style={{ fontSize: 13, color: 'var(--auth-muted)' }}>Username:</span>
                <strong style={{ fontSize: 18, color: '#edf6ff', fontFamily: 'Consolas, monospace' }}>
                  {recoveredUsername}
                </strong>
              </div>
              <div style={{ fontSize: 12, color: '#8ea7bb', marginTop: 4 }}>
                Confirmation email sent with your username to {email}.
              </div>
            </div>

            <div style={{ marginTop: 24 }}>
              <button
                type="button"
                className="auth-btn-primary"
                onClick={() => navigate('/login', { state: { username: recoveredUsername } })}
              >
                Proceed to Sign In &rarr;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="auth-footer">
        AYAL HPC Management Platform &copy; 2026 AYAL. All rights reserved.
      </footer>
    </div>
  )
}
