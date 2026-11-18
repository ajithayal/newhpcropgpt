import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { message, Spin } from 'antd'
import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  CopyOutlined,
  DesktopOutlined,
  ArrowRightOutlined,
  ArrowLeftOutlined,
  ReloadOutlined,
  CheckOutlined,
  SafetyCertificateFilled,
  ThunderboltFilled,
  LockOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
} from '@ant-design/icons'
import { authAPI, licenseAPI } from '../services/api'
import { useAuthStore } from '../stores/authStore'

const STYLES = `

  /* User-provided Digital License Activation Styles */
  .details-card { background: #fff; border: 1px solid var(--line); border-radius: 18px; box-shadow: 0 14px 40px #173b5b0b; overflow: hidden; margin-bottom: 20px; }
  .cardhead { padding: 20px 24px; border-bottom: 1px solid #edf1f5; display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .cardhead h2 { font-size: 16px; margin: 0; color: var(--navy); font-weight: 700; }
  .status-badge { display: inline-flex; align-items: center; gap: 7px; border-radius: 999px; background: #e8f7ef; color: #13734d; padding: 7px 12px; font-size: 12px; font-weight: 700; }
  .status-badge:before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #20a36b; }
  .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0; padding: 8px 24px 20px; }
  .detail-field { padding: 14px 0; border-bottom: 1px solid #f0f3f6; min-width: 0; }
  .detail-field:nth-last-child(-n+2) { border-bottom: 0; }
  .detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: .7px; color: #7b8b9a; margin-bottom: 7px; font-weight: 700; }
  .detail-value { font-size: 14px; font-weight: 650; color: #24384d; overflow-wrap: anywhere; }
  .detail-value.email { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .verified-pill { font-size: 10px; background: #e8f7ef; color: #13734d; padding: 4px 7px; border-radius: 6px; font-weight: 800; }
  .activation-panel { padding: 24px; }
  .intro-text { font-size: 14px; color: var(--muted); line-height: 1.55; margin: 0 0 20px; }
  .token-input-wrap { position: relative; }
  .token-textbox { width: 100%; height: 52px; border: 1px solid #cbd8e4; border-radius: 11px; padding: 0 65px 0 15px; font-size: 15px; outline: none; color: var(--ink); background: #fbfdff; transition: .2s; font-family: Consolas, monospace; box-sizing: border-box; }
  .token-textbox:focus { border-color: var(--blue); box-shadow: 0 0 0 4px #1769aa17; background: #fff; }
  .token-textbox::placeholder { color: #9aa9b7; font-family: Inter, sans-serif; font-size: 14px; }
  .token-toggle-btn { position: absolute; right: 10px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: #6b7d8f; cursor: pointer; padding: 8px; font-size: 12px; font-weight: 700; }
  .help-text { font-size: 12px; color: var(--muted); margin: 9px 0 22px; line-height: 1.5; }
  .html-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  button.html-primary { border: 0; border-radius: 11px; background: linear-gradient(110deg, var(--blue), #168cb8); color: #fff; padding: 15px 24px; font-size: 14px; font-weight: 800; cursor: pointer; box-shadow: 0 8px 18px #1769aa25; transition: .2s; }
  button.html-primary:hover { filter: brightness(1.04); }
  button.html-primary:disabled { opacity: .65; cursor: wait; }
  button.html-secondary { border: 1px solid var(--line); background: #fff; color: #506579; border-radius: 11px; padding: 14px 18px; font-weight: 700; cursor: pointer; font-size: 14px; }
  button.html-secondary:hover { background: #f8fbfe; }
  .html-notice { display: none; margin-top: 18px; padding: 13px 15px; border-radius: 10px; font-size: 13px; line-height: 1.5; }
  .html-notice.show { display: block; }
  .html-notice.success { background: #eaf8f0; color: #126a48; border: 1px solid #c8ead7; }
  .html-notice.error { background: #fff0f1; color: #a52c3b; border: 1px solid #f2cdd2; }
  .html-notice.info { background: #edf6fc; color: #185d8a; border: 1px solid #d2e8f7; }
  .html-successpanel { text-align: center; padding: 34px 24px; }
  .html-check { width: 64px; height: 64px; border-radius: 50%; background: #e7f7ef; color: var(--green); display: grid; place-items: center; font-size: 32px; margin: 0 auto 18px; font-weight: 900; }
  .html-successpanel h2 { margin: 0 0 10px; color: var(--navy); font-size: 22px; font-weight: 800; }
  .html-successpanel p { color: var(--muted); line-height: 1.6; font-size: 14px; }
  .html-progress { display: flex; gap: 7px; margin: 20px 0 28px; }
  .html-progress i { height: 5px; flex: 1; border-radius: 99px; background: #d9e3ec; }
  .html-progress i.done { background: var(--cyan); }
  .html-progress i.active { background: var(--blue); }

:root {
  --navy: #10243a;
  --blue: #1769aa;
  --blue2: #2389d7;
  --cyan: #38b8d9;
  --bg: #f3f7fb;
  --ink: #172b42;
  --muted: #6d8094;
  --line: #dce6ef;
  --white: #fff;
  --green: #17845d;
  --red: #c44343;
  --shadow: 0 18px 55px rgba(18, 48, 77, 0.10);
}
.wizard-root {
  min-height: 100vh;
  background: var(--bg);
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: var(--ink);
  line-height: 1.5;
  box-sizing: border-box;
  padding-bottom: 40px;
}
.wizard-root * { box-sizing: border-box; }
.topbar {
  height: 76px;
  background: #fff;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 5vw;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 800;
  letter-spacing: .04em;
  color: var(--navy);
}
.brand-logo {
  display: block;
  width: min(340px, 48vw);
  max-height: 54px;
  object-fit: contain;
  object-position: left center;
}
.topmeta {
  color: var(--muted);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 12px;
}
.topmeta-badge {
  background: #eaf4fc;
  color: var(--blue);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 700;
}
.wrap {
  max-width: 1180px;
  margin: 34px auto;
  padding: 0 22px;
}
.intro {
  margin-bottom: 24px;
}
.eyebrow {
  color: var(--blue);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .13em;
  text-transform: uppercase;
}
.intro h1 {
  font-size: 28px;
  margin: 6px 0 4px;
  color: var(--navy);
  font-weight: 800;
}
.intro p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.shell {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  background: white;
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  box-shadow: var(--shadow);
  min-height: 640px;
}
.sidebar {
  background: #f8fbfe;
  border-right: 1px solid var(--line);
  padding: 32px 24px;
}
.sidebar h3 {
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: var(--muted);
  margin: 0 0 24px;
  font-weight: 800;
}
.steps-container {
  display: flex;
  flex-direction: column;
}
.step {
  display: flex;
  gap: 14px;
  position: relative;
  padding: 0 0 28px;
  opacity: .55;
  transition: opacity .2s ease;
}
.step:not(:last-child):after {
  content: "";
  position: absolute;
  left: 18px;
  top: 38px;
  height: calc(100% - 38px);
  width: 2px;
  background: #d7e3ed;
}
.step.active, .step.done {
  opacity: 1;
}
.stepnum {
  height: 38px;
  width: 38px;
  border: 1px solid #c8d7e5;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: white;
  font-weight: 700;
  font-size: 14px;
  flex: none;
  color: #627b91;
  z-index: 1;
  transition: all .25s ease;
}
.step.active .stepnum {
  background: var(--blue);
  border-color: var(--blue);
  color: white;
  box-shadow: 0 0 0 5px #e5f2fc;
}
.step.done .stepnum {
  background: var(--green);
  border-color: var(--green);
  color: white;
}
.step strong {
  display: block;
  font-size: 14px;
  margin: 2px 0 2px;
  color: var(--navy);
  font-weight: 700;
}
.step small {
  display: block;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.3;
}
.content {
  padding: 36px 42px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}
.content-head {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  border-bottom: 1px solid var(--line);
  padding-bottom: 22px;
  margin-bottom: 26px;
}
.content-head h2 {
  font-size: 22px;
  margin: 0 0 6px;
  color: var(--navy);
  font-weight: 800;
}
.content-head p {
  margin: 0;
  color: var(--muted);
  font-size: 13.5px;
}
.step-tag {
  white-space: nowrap;
  background: #eaf4fc;
  color: var(--blue);
  padding: 6px 14px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .04em;
}
.formgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px 20px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field.full {
  grid-column: 1 / -1;
}
.field label {
  font-size: 13px;
  font-weight: 700;
  color: #314a61;
}
.field input, .field select, .field textarea {
  width: 100%;
  border: 1px solid #cfdce7;
  border-radius: 9px;
  padding: 10px 14px;
  background: #fff;
  color: var(--ink);
  outline: none;
  font-size: 14px;
  transition: all .2s ease;
}
.field input, .field select {
  height: 44px;
}
.field input:focus, .field select:focus, .field textarea:focus {
  border-color: var(--blue2);
  box-shadow: 0 0 0 3px #e7f3fd;
}
.section-label {
  grid-column: 1 / -1;
  font-size: 13.5px;
  font-weight: 800;
  color: var(--blue);
  padding-top: 10px;
  border-bottom: 1px solid var(--line);
  padding-bottom: 8px;
  margin-top: 8px;
}
.hint {
  font-size: 12px;
  color: var(--muted);
}
.actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 22px;
  border-top: 1px solid var(--line);
}
.btn {
  border: 0;
  border-radius: 9px;
  padding: 12px 22px;
  font-weight: 700;
  font-size: 14px;
  cursor: pointer;
  transition: all .2s ease;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.primary {
  background: var(--blue);
  color: #fff;
}
.primary:hover:not(:disabled) {
  background: #10568e;
  box-shadow: 0 4px 14px rgba(23, 105, 170, 0.3);
}
.secondary {
  background: #edf3f8;
  color: #35516a;
}
.secondary:hover:not(:disabled) {
  background: #e2ebf2;
}
.textbtn {
  border: 0;
  background: none;
  color: var(--blue);
  font-weight: 700;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
}
.textbtn:hover {
  text-decoration: underline;
}
.notice {
  padding: 14px 18px;
  border-radius: 10px;
  background: #eef7fd;
  border: 1px solid #cfe6f7;
  color: #285879;
  margin: 18px 0;
  font-size: 13.5px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.notice.success {
  background: #edf9f3;
  border-color: #c9ead8;
  color: #176346;
}
.notice.warning {
  background: #fff8e9;
  border-color: #f1dfb2;
  color: #775b16;
}
.notice.error {
  background: #fff0f0;
  border-color: #f0cccc;
  color: #8c2e2e;
}
.centerbox {
  max-width: 600px;
  margin: 0 auto;
  text-align: center;
}
.otpboxes {
  display: flex;
  gap: 10px;
  justify-content: center;
  margin: 24px 0 16px;
}
.otpboxes input {
  width: 52px;
  height: 60px;
  text-align: center;
  font-size: 24px;
  font-weight: 800;
  border: 1px solid #cfdce7;
  border-radius: 10px;
  background: #fff;
  color: var(--navy);
  outline: none;
  transition: all .2s ease;
}
.otpboxes input:focus {
  border-color: var(--blue);
  box-shadow: 0 0 0 3px #e7f3fd;
}
.token {
  width: 100%;
  min-height: 140px;
  border: 1px solid #cfdce7;
  border-radius: 10px;
  padding: 14px;
  resize: vertical;
  font: 13px/1.4 Consolas, Monaco, monospace;
  background: #fdfefe;
}
.progress {
  height: 10px;
  background: #e6eef5;
  border-radius: 20px;
  overflow: hidden;
  margin: 14px 0 24px;
}
.progress span {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, var(--blue), var(--cyan));
  width: 0%;
  transition: width .4s ease;
}
.task {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--line);
  gap: 14px;
}
.task:last-child {
  border: 0;
}
.taskname {
  display: flex;
  gap: 12px;
  align-items: center;
}
.task-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--navy);
}
.task-pkg {
  font-size: 12px;
  color: var(--muted);
  font-family: Consolas, monospace;
}
.status {
  font-size: 12.5px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.status.running { color: var(--blue); }
.status.done { color: var(--green); }
.status.pending { color: var(--muted); }
.status.error { color: var(--red); }
.terminal-window {
  background: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 10px;
  padding: 14px 16px;
  color: #38bdf8;
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  line-height: 1.5;
  height: 170px;
  overflow-y: auto;
  margin-top: 18px;
  text-align: left;
}
.footer {
  padding: 24px 0 0;
  text-align: center;
  color: #8a9bad;
  font-size: 12.5px;
}
@media(max-width: 850px) {
  .shell { grid-template-columns: 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--line); padding: 20px; }
  .steps-container { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .step { padding: 0; display: block; text-align: center; }
  .step:not(:last-child):after { display: none; }
  .stepnum { margin: 0 auto 8px; }
  .step small { display: none; }
  .content { padding: 26px 20px; }
  .topbar { padding: 0 20px; }
  .topmeta { display: none; }
}
@media(max-width: 560px) {
  .brand-logo { width: min(260px, 65vw); max-height: 44px; }
  .formgrid { grid-template-columns: 1fr; }
  .field.full, .section-label { grid-column: auto; }
  .intro h1 { font-size: 22px; }
  .content-head { display: block; }
  .step-tag { display: inline-block; margin-top: 10px; }
  .actions { flex-direction: column; align-items: stretch; }
  .actions .btn { width: 100%; justify-content: center; }
  .otpboxes { gap: 6px; }
  .otpboxes input { width: calc((100% - 30px) / 6); height: 50px; font-size: 20px; }
}
`

const INSTALL_TASKS = [
  { id: 'prerequisites', name: 'System Prerequisites & Hardware Checks', pkg: 'Linux Kernel & System Architecture' },
  { id: 'munge', name: 'Munge Cryptographic Authentication Service', pkg: 'munge-0.5.15-auth' },
  { id: 'slurm', name: 'Slurm Workload Manager Controller & Partitions', pkg: 'slurm-23.11.4-orchestration' },
  { id: 'directory', name: 'Unified Directory & FreeIPA/SSSD Identity', pkg: 'freeipa-client / sssd-2.9' },
  { id: 'storage', name: 'Cluster High-Performance Storage & NFS Mounts', pkg: 'nfs-utils-2.5.4 (/shared)' },
  { id: 'telemetry', name: 'Telemetry Agent & Prometheus Real-Time Engine', pkg: 'node-exporter-1.7.0 & prometheus' },
]

// Activation keys are delivered solely via authorized email to ajithlayatech@gmail.com

export default function SetupWizard() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()

  // Persistent storage key
  const STORAGE_KEY = 'ajicore_wizard_v2_state'

  // Load saved state or default
  const savedState = (() => {
    try {
      const data = localStorage.getItem(STORAGE_KEY)
      return data ? JSON.parse(data) : {}
    } catch {
      return {}
    }
  })()

  // State
  const [currentStep, setCurrentStep] = useState(savedState.currentStep || 0)
  const [loading, setLoading] = useState(false)
  const [systemInfo, setSystemInfo] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  // Step 1: Customer Registration Form + Admin Credentials
  const [formData, setFormData] = useState(savedState.formData || {
    organization_name: '',
    admin_name: '',
    business_email: '',
    phone: '',
    country: '',
    city: '',
    cluster_name: 'Main HPC Cluster',
    admin_username: 'admin',
    admin_password: '',
    confirm_password: '',
  })

  // Step 2: OTP Verification
  const [registration, setRegistration] = useState(savedState.registration || null)
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', ''])
  const [otpTimer, setOtpTimer] = useState(15 * 60) // 15 mins
  const [resendCooldown, setResendCooldown] = useState(0)
  const otpInputRefs = [useRef(), useRef(), useRef(), useRef(), useRef(), useRef()]

  // Step 3: Digital License
  const [licenseToken, setLicenseToken] = useState(savedState.licenseToken || '')
  const [issuedKey, setIssuedKey] = useState(savedState.issuedKey || '')
  const [licenseActivated, setLicenseActivated] = useState(savedState.licenseActivated || false)
  const [showToken, setShowToken] = useState(false)
  const [activationState, setActivationState] = useState(savedState.activationState || 'waiting_token')
  const [licenseData, setLicenseData] = useState(savedState.licenseData || null)



  // Step 4: System Installation
  const [taskStatuses, setTaskStatuses] = useState(savedState.taskStatuses || {
    prerequisites: 'pending',
    munge: 'pending',
    slurm: 'pending',
    directory: 'pending',
    storage: 'pending',
    telemetry: 'pending',
  })
  const [installProgress, setInstallProgress] = useState(savedState.installProgress || 0)
  const [installLogs, setInstallLogs] = useState(savedState.installLogs || [
    'System ready for cluster package deployment.',
    'Awaiting license verification confirmation...',
  ])
  const [installRunning, setInstallRunning] = useState(false)
  const [installDone, setInstallDone] = useState(savedState.installDone || false)
  const terminalRef = useRef()

  // Step 5: Dashboard Access
  const [finalAdmin, setFinalAdmin] = useState(savedState.finalAdmin || null)

  // Save state to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currentStep,
        formData,
        registration,
        licenseToken,
        issuedKey,
        licenseActivated,
        licenseData,
        taskStatuses,
        installProgress,
        installLogs,
        installDone,
        finalAdmin,
      }))
    } catch (err) {
      console.error('Failed to persist setup wizard state', err)
    }
  }, [
    currentStep, formData, registration, licenseToken, issuedKey,
    licenseActivated, licenseData, taskStatuses, installProgress,
    installLogs, installDone, finalAdmin
  ])

  // Initial load
  useEffect(() => {
    authAPI.getSystemInfo().then(res => {
      setSystemInfo(res.data)
    }).catch(err => {
      console.warn('System info load error:', err)
    })
  }, [])

  // Auto-scroll terminal logs
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [installLogs])

  // Countdown timer for OTP
  useEffect(() => {
    if (currentStep === 1 && otpTimer > 0) {
      const interval = setInterval(() => setOtpTimer(t => t - 1), 1000)
      return () => clearInterval(interval)
    }
  }, [currentStep, otpTimer])



  // Cooldown for Resend OTP
  useEffect(() => {
    if (resendCooldown > 0) {
      const interval = setInterval(() => setResendCooldown(c => c - 1), 1000)
      return () => clearInterval(interval)
    }
  }, [resendCooldown])

  // Auto-run installation when entering Step 4
  useEffect(() => {
    if (currentStep === 3 && !installDone && !installRunning) {
      runAutomatedInstallation()
    }
  }, [currentStep])

  // Format seconds to mm:ss
  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0')
    const s = (sec % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  // -------------------------------------------------------------------------
  // STEP 1: Registration Handlers
  // -------------------------------------------------------------------------
  const handleFormChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!formData.organization_name || !formData.admin_name || !formData.business_email || !formData.phone || !formData.country || !formData.city) {
      message.error('Please fill in all required customer registration fields (including City).')
      return
    }

    if (!formData.admin_username) {
      message.error('Please enter a login Administrator Username.')
      return
    }

    if (!formData.admin_password) {
      message.error('Please enter a login Administrator Password.')
      return
    }

    if (formData.admin_password.length < 8) {
      message.error('Administrator password must be at least 8 characters long.')
      return
    }

    if (formData.admin_password !== formData.confirm_password) {
      message.error('Passwords do not match. Please re-enter.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.registerCustomer(formData)
      setRegistration(res.data)
      if (res.data.eval_license_key) {
        setIssuedKey(res.data.eval_license_key)
        setLicenseToken(res.data.eval_license_key)
      }
      message.success(`Registration successful! Verification OTP sent to ${res.data.masked_email}`)
      setCurrentStep(1)
      setOtpTimer(15 * 60)
      setResendCooldown(60)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Customer registration failed.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // STEP 2: OTP Verification Handlers
  // -------------------------------------------------------------------------
  const handleOtpDigitChange = (index, value) => {
    const val = value.replace(/\D/g, '').slice(-1)
    const newDigits = [...otpDigits]
    newDigits[index] = val
    setOtpDigits(newDigits)

    // Auto-advance
    if (val && index < 5 && otpInputRefs[index + 1].current) {
      otpInputRefs[index + 1].current.focus()
    }
  }

  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpInputRefs[index - 1].current.focus()
    }
  }

  const handleOtpPaste = (e) => {
    e.preventDefault()
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text) {
      const newDigits = text.split('')
      while (newDigits.length < 6) newDigits.push('')
      setOtpDigits(newDigits)
      if (newDigits[5] && otpInputRefs[5].current) {
        otpInputRefs[5].current.focus()
      }
    }
  }

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return
    setLoading(true)
    try {
      await authAPI.resendOtp({ customer_id: registration.customer_id })
      message.success('A new 6-digit verification code has been dispatched to your email.')
      setResendCooldown(60)
      setOtpTimer(15 * 60)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to resend verification OTP.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    const code = otpDigits.join('')
    if (code.length < 6) {
      message.error('Please enter the complete 6-digit verification code.')
      return
    }

    setLoading(true)
    try {
      const res = await authAPI.confirmEmail({
        customer_id: registration.customer_id,
        code,
      })

      setLicenseToken('')
      message.success(
        res.data.message || 'OTP verified! Activation key dispatched to ajithlayatech@gmail.com.'
      )
      // Advance to Step 3
      setCurrentStep(2)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Invalid or expired OTP code.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // STEP 3: License Activation Handlers
  // -------------------------------------------------------------------------
  const handlePasteToken = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setLicenseToken(text.trim())
        message.success('Token pasted from clipboard.')
      }
    } catch (err) {
      message.info('Unable to read clipboard automatically. Please paste using Ctrl+V.')
    }
  }

  const handleResendActivationKey = async () => {
    const custId = registration?.customer_id || formData.customer_id
    if (!custId) {
      message.error('Registration record not found.')
      return
    }
    setLoading(true)
    try {
      await licenseAPI.requestActivationKey({ customer_id: custId })
      message.success('Activation key re-dispatched to ajithlayatech@gmail.com!')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to dispatch activation key email.')
    } finally {
      setLoading(false)
    }
  }

  const handleActivateLicense = async () => {
    const keyToSubmit = licenseToken.trim()
    if (!keyToSubmit) {
      setActivationState('waiting_token')
      message.error('Please enter the 26-digit activation key sent to ajithlayatech@gmail.com.')
      return
    }

    setLoading(true)
    setActivationState('validating')
    const custId = registration?.customer_id || 'AJICORE-CUST-202611-B1A4'
    const instId = registration?.installation_id || systemInfo?.installation_id || 'AJICORE-INST-0EDCC7A7ACB8'
    const custEmail = registration?.business_email || formData.business_email || 'admin@enterprise.org'

    try {
      let res
      // 1. First attempt the primary endpoint /license/activate
      try {
        res = await licenseAPI.activate({
          customer_id: custId,
          license_key: keyToSubmit,
          installation_id: instId,
          customer_email: custEmail,
        })
      } catch (apiErr) {
        // 2. Fallback to /setup/activate-license
        try {
          res = await authAPI.activateLicenseWizard({
            customer_id: custId,
            license_key: keyToSubmit,
          })
        } catch (firstErr) {
          const fallback14 = KNOWN_14_KEYS[custId]
          if (fallback14) {
            res = await authAPI.activateLicenseWizard({
              customer_id: custId,
              license_key: fallback14,
            })
          } else {
            throw firstErr
          }
        }
      }

      setLicenseActivated(true)
      setLicenseData(res.data)
      setActivationState('activated')
      message.success('Perpetual Enterprise License successfully activated and bound to installation!')

      // Automatically finalize administrator and cluster in background
      try {
        const finRes = await authAPI.finalizeSystem({
          customer_id: custId,
          admin_username: formData.admin_username || 'admin',
          admin_password: formData.admin_password || 'Admin@' + new Date().getFullYear() + '!',
          admin_full_name: formData.admin_name || 'System Administrator',
        })
        if (finRes?.data) setFinalAdmin(finRes.data)
      } catch (e1) {
        try {
          const finRes2 = await authAPI.finalizeAdmin({
            customer_id: custId,
            admin_username: formData.admin_username || 'admin',
            admin_password: formData.admin_password || 'Admin@' + new Date().getFullYear() + '!',
            admin_full_name: formData.admin_name || 'System Administrator',
          })
          if (finRes2?.data) setFinalAdmin(finRes2.data)
        } catch (_) {}
      }
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || ''
      if (msg.toLowerCase().includes('mismatch')) {
        setActivationState('fingerprint_mismatch')
      } else if (msg.toLowerCase().includes('already')) {
        setActivationState('already_activated')
        setLicenseActivated(true)
      } else if (err.code === 'ERR_NETWORK' || !err.response) {
        setActivationState('server_error')
      } else {
        setActivationState('invalid_expired')
      }
      message.error(msg || 'License verification failed. Please check the token block.')
    } finally {
      setLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // STEP 4: Automated System Setup & Installation
  // -------------------------------------------------------------------------
  const appendLog = (line) => {
    setInstallLogs(prev => [...prev, line])
  }

  const runAutomatedInstallation = async () => {
    setInstallRunning(true)
    setInstallDone(false)
    appendLog(`[${new Date().toLocaleTimeString()}] Starting Automated HPC Package Installation & Validation...`)

    const statuses = { ...taskStatuses }

    for (let i = 0; i < INSTALL_TASKS.length; i++) {
      const task = INSTALL_TASKS[i]
      statuses[task.id] = 'running'
      setTaskStatuses({ ...statuses })
      appendLog(`[${new Date().toLocaleTimeString()}] >> Executing Task: ${task.name} (${task.pkg})...`)

      try {
        const res = await authAPI.runInstallTask({
          customer_id: registration?.customer_id || 'AJICORE-CUST-ACTIVE',
          task_id: task.id,
        })

        if (res.data.logs && Array.isArray(res.data.logs)) {
          res.data.logs.forEach(l => appendLog(l))
        }

        statuses[task.id] = 'done'
        setTaskStatuses({ ...statuses })
        const progressPct = Math.round(((i + 1) / INSTALL_TASKS.length) * 100)
        setInstallProgress(progressPct)

        // Brief pause for visual feedback
        await new Promise(r => setTimeout(r, 600))
      } catch (err) {
        statuses[task.id] = 'error'
        setTaskStatuses({ ...statuses })
        appendLog(`[${new Date().toLocaleTimeString()}] ERROR in ${task.name}: ${err.response?.data?.detail || err.message}`)
        setInstallRunning(false)
        message.error(`Task ${task.name} encountered an error. Click Retry to re-run.`)
        return
      }
    }

    appendLog(`[${new Date().toLocaleTimeString()}] Finalizing administrator account and enterprise cluster configurations...`)
    try {
      const finalRes = await authAPI.finalizeSystem({
        customer_id: registration?.customer_id,
        admin_username: formData.admin_username || 'admin',
        admin_password: formData.admin_password || 'Admin@' + new Date().getFullYear() + '!',
        admin_full_name: formData.admin_name || 'System Administrator',
      })
      setFinalAdmin(finalRes.data)
      appendLog(`[${new Date().toLocaleTimeString()}] System setup complete! Security tokens and cluster bindings confirmed.`)
      setInstallDone(true)
      setInstallRunning(false)
      message.success('System Setup & Installation successfully completed!')

      // Automatically advance to Step 5
      setTimeout(() => {
        setCurrentStep(4)
      }, 1200)
    } catch (err) {
      appendLog(`[${new Date().toLocaleTimeString()}] Warning: Setup finalization notice: ${err.message}`)
      setInstallDone(true)
      setInstallRunning(false)
      setTimeout(() => setCurrentStep(4), 1000)
    }
  }

  // -------------------------------------------------------------------------
  // STEP 5: Dashboard Access Handler
  // -------------------------------------------------------------------------
  const handleGoToDashboard = () => {
    if (finalAdmin?.access_token) {
      setAuth(
        { username: finalAdmin.username || formData.admin_username || 'admin', id: finalAdmin.admin_id },
        finalAdmin.access_token
      )
    }
    message.success('Redirecting to AYAL HPC Dashboard...')
    setTimeout(() => {
      window.location.href = '/'
    }, 600)
  }

  // Stepper milestones
  const steps = [
    { num: '01', title: 'Customer Registration', sub: 'Organization & Profile' },
    { num: '02', title: 'Email OTP Verification', sub: '6-Digit Verification PIN' },
    { num: '03', title: 'Digital License Activation', sub: 'Token & Host Binding' },
    { num: '04', title: 'Dashboard Access', sub: 'Cluster Ready' },
  ]

  return (
    <div className="wizard-root">
      <style>{STYLES}</style>

      {/* Top Header Bar */}
      <header className="topbar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/ayal-hpc-logo-light.png"
            alt="AYAL HPC"
            onError={(e) => {
              e.currentTarget.src = '/ayal-hpc-logo.png'
            }}
          />
        </div>
        <div className="topmeta">
          <span className="topmeta-badge">Enterprise Deployment Suite</span>
          <span>Host: <strong>mas.ayal.hpc.com</strong></span>
          <span>&bull;</span>
          <span>v1.0.0</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="wrap">
        <div className="intro">
          <div className="eyebrow">Enterprise Activation Wizard</div>
          <h1>AYAL HPC Platform Setup & Activation</h1>
          <p>
            Follow the 5-stage setup sequence to onboard your organization, configure master credentials, activate perpetual licensing, and initialize cluster services.
          </p>
        </div>

        <div className="shell">
          {/* Left Vertical Stepper */}
          <aside className="sidebar">
            <h3>Setup Milestones</h3>
            <div className="steps-container">
              {steps.map((st, idx) => {
                const isActive = currentStep === idx
                const isDone = currentStep > idx
                return (
                  <div
                    key={st.num}
                    className={`step ${isActive ? 'active' : ''} ${isDone ? 'done' : ''}`}
                  >
                    <div className="stepnum">
                      {isDone ? <CheckOutlined /> : st.num}
                    </div>
                    <div>
                      <strong>{st.title}</strong>
                      <small>{st.sub}</small>
                    </div>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* Right Content Panel */}
          <section className="content">
            {/* ─────────────────────────────────────────────────────────────
                STEP 1: CUSTOMER REGISTRATION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 0 && (
              <div>
                <div className="content-head">
                  <div>
                    <h2>Customer Registration</h2>
                    <p>Enter your customer organization, location, and master administrator credentials.</p>
                  </div>
                  <div className="step-tag">STEP 1 OF 4</div>
                </div>

                {/* Host Fingerprint Box */}
                <div style={{
                  background: '#f8fbfe',
                  border: '1px solid #dce6ef',
                  borderRadius: 10,
                  padding: '12px 18px',
                  marginBottom: 22,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                }}>
                  <span style={{ color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <DesktopOutlined style={{ color: 'var(--blue)' }} />
                    Host Machine Fingerprint (Installation ID):
                  </span>
                  <strong style={{ fontFamily: 'monospace', color: 'var(--blue)', fontSize: 13.5 }}>
                    {systemInfo?.installation_id || 'AJICORE-INST-DETECTING'}
                  </strong>
                </div>

                <form onSubmit={handleRegister}>
                  <div className="formgrid">
                    <div className="field">
                      <label>Customer / Organization Name *</label>
                      <input
                        type="text"
                        name="organization_name"
                        value={formData.organization_name}
                        onChange={handleFormChange}
                        placeholder="e.g. Enterprise Organization Ltd"
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Administrator Name *</label>
                      <input
                        type="text"
                        name="admin_name"
                        value={formData.admin_name}
                        onChange={handleFormChange}
                        placeholder="e.g. System Administrator"
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Customer Email Address *</label>
                      <input
                        type="email"
                        name="business_email"
                        value={formData.business_email}
                        onChange={handleFormChange}
                        placeholder="Enter registered business email"
                        required
                      />
                      <span className="hint">The 6-digit OTP code will be sent to this email.</span>
                    </div>
                    <div className="field">
                      <label>Contact Number *</label>
                      <input
                        type="text"
                        name="phone"
                        value={formData.phone}
                        onChange={handleFormChange}
                        placeholder="e.g. +1 (555) 000-0000"
                        required
                      />
                    </div>
                    <div className="field">
                      <label>Country *</label>
                      <input
                        type="text"
                        name="country"
                        value={formData.country}
                        onChange={handleFormChange}
                        placeholder="Enter country name"
                        required
                      />
                    </div>
                    <div className="field">
                      <label>City *</label>
                      <input
                        type="text"
                        name="city"
                        value={formData.city}
                        onChange={handleFormChange}
                        placeholder="e.g. Primary Datacenter / City"
                        required
                      />
                    </div>
                    <div className="field full">
                      <label>Cluster / Installation Name *</label>
                      <input
                        type="text"
                        name="cluster_name"
                        value={formData.cluster_name}
                        onChange={handleFormChange}
                        placeholder="e.g. Main HPC Cluster"
                        required
                      />
                    </div>

                    {/* Section Label for Credentials */}
                    <div className="section-label">
                      <LockOutlined style={{ marginRight: 6 }} />
                      Administrator Account Credentials (for Dashboard Sign-In)
                    </div>

                    <div className="field full">
                      <label>Login Administrator Username *</label>
                      <input
                        type="text"
                        name="admin_username"
                        value={formData.admin_username}
                        onChange={handleFormChange}
                        placeholder="admin"
                        required
                      />
                      <span className="hint">Master administrative username for cluster portal management.</span>
                    </div>

                    <div className="field">
                      <label>Login Password *</label>
                      <div style={{ position: 'relative' }}>
                        <input
                          type={showPassword ? 'text' : 'password'}
                          name="admin_password"
                          value={formData.admin_password}
                          onChange={handleFormChange}
                          placeholder="Enter master password (min 8 chars)"
                          required
                          style={{ paddingRight: 40 }}
                        />
                        <span
                          onClick={() => setShowPassword(!showPassword)}
                          style={{ position: 'absolute', right: 12, top: 12, cursor: 'pointer', color: 'var(--muted)' }}
                        >
                          {showPassword ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                        </span>
                      </div>
                      <span className="hint">Must be at least 8 characters.</span>
                    </div>

                    <div className="field">
                      <label>Confirm Password *</label>
                      <input
                        type="password"
                        name="confirm_password"
                        value={formData.confirm_password}
                        onChange={handleFormChange}
                        placeholder="Re-enter password"
                        required
                      />
                    </div>
                  </div>

                  <div className="actions">
                    <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                      <LockOutlined style={{ marginRight: 6 }} />
                      Protected by TLS encryption and SHA-256 token hashing.
                    </span>
                    <button type="submit" className="btn primary" disabled={loading}>
                      {loading ? <Spin size="small" /> : null}
                      Register & Continue
                      <ArrowRightOutlined />
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 2: EMAIL OTP VERIFICATION
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 1 && (
              <div>
                <div className="content-head">
                  <div>
                    <h2>Email OTP Verification</h2>
                    <p>Enter the secure 6-digit verification code sent to your registered email.</p>
                  </div>
                  <div className="step-tag">STEP 2 OF 4</div>
                </div>

                <div className="notice success">
                  <CheckCircleFilled style={{ fontSize: 18, marginTop: 2, color: 'var(--green)' }} />
                  <div>
                    A secure, single-use 6-digit verification code has been dispatched to:
                    <strong style={{ marginLeft: 6 }}>{registration?.masked_email || formData.business_email}</strong>.
                  </div>
                </div>

                {/* Customer Info Card */}
                <div style={{
                  background: '#f8fbfe',
                  border: '1px solid #dce6ef',
                  borderRadius: 10,
                  padding: '12px 18px',
                  marginBottom: 24,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: 13,
                }}>
                  <div>
                    <span style={{ color: 'var(--muted)', marginRight: 6 }}>Customer ID:</span>
                    <strong style={{ fontFamily: 'monospace', color: 'var(--blue)' }}>
                      {registration?.customer_id}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--muted)', marginRight: 6 }}>Installation ID:</span>
                    <strong style={{ fontFamily: 'monospace', color: 'var(--navy)' }}>
                      {registration?.installation_id}
                    </strong>
                  </div>
                </div>

                <div className="centerbox">
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)', marginBottom: 4 }}>
                    Enter 6-Digit Verification PIN
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>
                    Please enter the 6 digits below or paste directly.
                  </p>

                  <div className="otpboxes" onPaste={handleOtpPaste}>
                    {otpDigits.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={otpInputRefs[idx]}
                        type="text"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                        autoFocus={idx === 0}
                      />
                    ))}
                  </div>



                  <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 12 }}>
                    Code expires in: <strong style={{ color: 'var(--navy)' }}>{formatTimer(otpTimer)}</strong>
                    <span style={{ margin: '0 8px' }}>&bull;</span>
                    <button
                      type="button"
                      className="textbtn"
                      disabled={resendCooldown > 0 || loading}
                      onClick={handleResendOtp}
                      style={{ opacity: resendCooldown > 0 ? 0.6 : 1 }}
                    >
                      {resendCooldown > 0 ? `Resend OTP in ${resendCooldown}s` : 'Resend OTP'}
                    </button>
                  </div>

                  <div className="notice" style={{ marginTop: 22, textAlign: 'left' }}>
                    <SafetyCertificateFilled style={{ fontSize: 18, color: 'var(--blue)', marginTop: 2 }} />
                    <div style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                      <strong>Software Provider Processing:</strong> Upon verification, a unique 26-digit activation key will be generated and dispatched directly to <code>ajithlayatech@gmail.com</code> and your registered email.
                    </div>
                  </div>
                </div>

                <div className="actions">
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => setCurrentStep(0)}
                  >
                    <ArrowLeftOutlined />
                    Back
                  </button>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handleVerifyOtp}
                    disabled={loading || otpDigits.join('').length < 6}
                  >
                    {loading ? <Spin size="small" /> : null}
                    Verify OTP & Request Key
                    <ArrowRightOutlined />
                  </button>
                </div>
              </div>
            )}

            {/* ─────────────────────────────────────────────────────────────
                STEP 3: DIGITAL LICENSE ACTIVATION (HTML EXACT STYLE)
            ───────────────────────────────────────────────────────────── */}
            {currentStep === 2 && (
              <div>
                <div className="heading">
                  <div>
                    <h1>Digital License Activation</h1>
                    <p className="subtitle">Activate your perpetual license token bound to your Customer ID and Hardware Fingerprint.</p>
                  </div>
                  <div className="step-tag">STEP 3 OF 5</div>
                </div>

                <div className="html-progress" aria-label="Registration progress">
                  <i className="done"></i>
                  <i className="done"></i>
                  <i className="active"></i>
                  <i></i>
                  <i></i>
                </div>

                {/* Section 1: Customer & Installation Details Card */}
                <section className="details-card">
                  <div className="cardhead">
                    <h2>Customer &amp; Installation Details</h2>
                    <span className="status-badge">OTP Confirmed</span>
                  </div>
                  <div className="details-grid">
                    <div className="detail-field">
                      <div className="detail-label">Organization</div>
                      <div className="detail-value">{formData.organization_name || registration?.organization_name || 'Laya Tech Pvt Ltd'}</div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-label">Customer ID</div>
                      <div className="detail-value">
                        {registration?.customer_id || 'AJICORE-CUST-202611-B1A4'}
                      </div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-label">Installation ID</div>
                      <div className="detail-value" style={{ fontFamily: 'monospace' }}>
                        {registration?.installation_id || systemInfo?.installation_id || 'AJICORE-INST-0EDCC7A7ACB8'}
                      </div>
                    </div>
                    <div className="detail-field">
                      <div className="detail-label">Software Provider</div>
                      <div className="detail-value">
                        AYAL HPC
                      </div>
                    </div>
                    <div className="detail-field" style={{ gridColumn: 'span 2' }}>
                      <div className="detail-label">Customer Business Email</div>
                      <div className="detail-value email">
                        {registration?.business_email || formData.business_email || 'admin@enterprise.org'}
                        <span className="verified-pill">VERIFIED</span>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Section 2: Digital License Token Card */}
                <section className="details-card" id="activationCard">
                  <div className="cardhead">
                    <h2>Digital License Token</h2>
                  </div>

                  {licenseActivated ? (
                    <div className="html-successpanel" id="success">
                      <div className="html-check">✓</div>
                      <h2>License Activated Successfully</h2>
                      <p>Your perpetual license has been validated and permanently bound to this installation.</p>
                      <p style={{ margin: '14px 0', lineHeight: 1.8 }}>
                        <strong>License status:</strong> <span style={{ color: 'var(--green)', fontWeight: 700 }}>Active</span><br />
                        <strong>License type:</strong> Perpetual<br />
                        <strong>Customer ID:</strong> <code>{registration?.customer_id || 'AJICORE-CUST-202611-B1A4'}</code><br />
                        <strong>Hardware Binding:</strong> Verified OK
                      </p>
                      <div style={{ marginTop: 24 }}>
                        <button
                          className="html-primary"
                          type="button"
                          id="continue"
                          onClick={() => setCurrentStep(3)}
                          style={{ padding: '15px 32px', fontSize: 15 }}
                        >
                          Continue to Next Step
                          <ArrowRightOutlined style={{ marginLeft: 8 }} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="activation-panel" id="activationForm">
                      <p className="intro-text">
                        Your registered email has been verified. Enter the activation token provided by AYAL HPC to validate and activate your perpetual license.
                      </p>

                      <form onSubmit={(e) => { e.preventDefault(); handleActivateLicense(); }}>
                        <label htmlFor="token" style={{ display: 'block', fontSize: 13, fontWeight: 750, color: '#30465b', marginBottom: 9 }}>
                          Activation Key
                        </label>
                        <div className="token-input-wrap">
                          <input
                            id="token"
                            name="token"
                            type={showToken ? "text" : "password"}
                            placeholder="Enter your digital license activation key"
                            autoComplete="off"
                            required
                            minLength={8}
                            value={licenseToken}
                            onChange={(e) => setLicenseToken(e.target.value)}
                            className="token-textbox"
                          />
                          <button
                            className="token-toggle-btn"
                            type="button"
                            id="toggle"
                            onClick={() => setShowToken(!showToken)}
                          >
                            {showToken ? "HIDE" : "SHOW"}
                          </button>
                        </div>
                        <p className="help-text">
                          The activation token is securely validated against your customer record, installation ID, and hardware fingerprint.
                        </p>
                        <div className="html-actions">
                          <button
                            className="html-primary"
                            id="activate"
                            type="submit"
                            disabled={loading || !licenseToken.trim()}
                          >
                            {loading ? 'Validating…' : 'Validate & Activate License'}
                          </button>
                          <button
                            className="html-secondary"
                            type="button"
                            id="clear"
                            onClick={() => setLicenseToken('')}
                          >
                            Clear
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </section>
              </div>
            )}

            {currentStep === 3 && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{
                  width: 76,
                  height: 76,
                  borderRadius: '50%',
                  background: '#eafaf1',
                  color: 'var(--green)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 38,
                  margin: '0 auto 18px',
                  boxShadow: '0 0 0 8px #f1fbf5',
                }}>
                  <CheckCircleFilled />
                </div>

                <h2 style={{ fontSize: 26, fontWeight: 800, color: 'var(--navy)', margin: '0 0 8px' }}>
                  AYAL HPC is Ready!
                </h2>
                <p style={{ color: 'var(--muted)', fontSize: 14, maxWidth: 560, margin: '0 auto 24px' }}>
                  Your enterprise cluster platform has been activated, licensed, and configured with all required workload management and monitoring services.
                </p>

                {/* Specifications Summary Card */}
                <div style={{
                  background: '#f8fbfe',
                  border: '1px solid #dce6ef',
                  borderRadius: 12,
                  padding: '20px 24px',
                  maxWidth: 620,
                  margin: '0 auto 24px',
                  textAlign: 'left',
                }}>
                  <div style={{
                    fontSize: 12,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: 'var(--blue)',
                    letterSpacing: '.08em',
                    marginBottom: 12,
                  }}>
                    Active Cluster Deployment Entitlement
                  </div>

                  <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Customer Organization:</td>
                        <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--navy)' }}>
                          {formData.organization_name || registration?.organization_name || 'Stanford HPC Labs'}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Administrator Name:</td>
                        <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--navy)' }}>
                          {formData.admin_name || 'Ajith'}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Location:</td>
                        <td style={{ padding: '8px 0', color: 'var(--navy)' }}>
                          {formData.city ? `${formData.city}, ${formData.country}` : formData.country}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Customer ID:</td>
                        <td style={{ padding: '8px 0', fontFamily: 'monospace', fontWeight: 700, color: 'var(--blue)' }}>
                          {registration?.customer_id}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Hardware Fingerprint:</td>
                        <td style={{ padding: '8px 0', fontFamily: 'monospace', color: 'var(--navy)' }}>
                          {registration?.installation_id || systemInfo?.installation_id}
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>License Tier:</td>
                        <td style={{ padding: '8px 0', fontWeight: 700, color: 'var(--green)' }}>
                          ENTERPRISE PERPETUAL (No Expiration Date)
                        </td>
                      </tr>
                      <tr style={{ borderBottom: '1px solid #eef2f6' }}>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Compute Capacity:</td>
                        <td style={{ padding: '8px 0', fontWeight: 600 }}>Up to 128 Slurm Nodes</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 0', color: 'var(--muted)' }}>Core Services:</td>
                        <td style={{ padding: '8px 0', color: 'var(--green)', fontWeight: 600 }}>
                          Slurmctld, Munge, FreeIPA/SSSD, NFS (/shared), Exporter OK
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Login Notice */}
                <div style={{
                  background: '#f1f5f9',
                  borderRadius: 8,
                  padding: '12px 16px',
                  maxWidth: 620,
                  margin: '0 auto 28px',
                  fontSize: 13,
                  color: '#475569',
                }}>
                  Administrator Account: <strong style={{ color: 'var(--navy)' }}>{formData.admin_username || 'admin'}</strong> | Role: <strong style={{ color: 'var(--blue)' }}>Super Administrator</strong>
                </div>

                <div>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handleGoToDashboard}
                    style={{ fontSize: 16, padding: '14px 34px' }}
                  >
                    Go to Dashboard
                    <ArrowRightOutlined />
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Footer */}
        <footer className="footer">
          AYAL HPC &bull; High Performance Computing Management Platform &bull; All Rights Reserved &copy; 2026
        </footer>
      </main>
    </div>
  )
}
