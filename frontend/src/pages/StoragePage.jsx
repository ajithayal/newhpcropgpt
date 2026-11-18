import React from 'react'
/**
 * AjiCorehpc Manager — Storage Management Page
 * Redesigned per Developer Prompt:
 * 1. Redundant header, cluster navigation, and sidebar submenus removed.
 * 2. 7 Direct tabs directly below global application header with responsive horizontal scrolling:
 *    - Storage Overview
 *    - NFS Configuration
 *    - Storage Volumes
 *    - Client Nodes
 *    - Cluster Storage Repository
 *    - Backup Jobs
 *    - Backup History
 * 3. Storage Overview with 4 Circular Progress (Donut) Charts.
 * 4. Duplicate File Manager removed from Storage.
 * 5. Cluster Storage Repository for repository configuration & capacity.
 * 6. Backup Jobs with multi-step review creation & management actions.
 * 7. Backup History catalog with filters, manifest inspection & restore wizard.
 */
import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Card, Row, Col, Typography, Button, Table, Tag, Space, Modal,
  Form, Input, InputNumber, Select, Checkbox, Progress, Alert,
  Badge, Tooltip, message, Popconfirm, Divider, Descriptions,
  Spin, DatePicker, Steps
} from 'antd'
import {
  HddOutlined, CloudServerOutlined, SettingOutlined,
  SafetyCertificateOutlined, ReloadOutlined, PlusOutlined, CheckCircleOutlined,
  CloseCircleOutlined, WarningOutlined, PlayCircleOutlined, RollbackOutlined,
  EyeOutlined, DeleteOutlined, EditOutlined, SyncOutlined, DatabaseOutlined,
  ClockCircleOutlined, PauseCircleOutlined, CheckOutlined, FilterOutlined,
  FolderOpenOutlined, ExclamationCircleOutlined, ToolOutlined
} from '@ant-design/icons'
import { storageAPI, backupAPI } from '../services/api'
import AppsStorageWizard from '../components/AppsStorageWizard'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function StoragePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') || 'overview'
  const tabParam = rawTab === 'cluster-repo' ? 'backup-storage' : rawTab
  const [activeTab, setActiveTab] = useState(tabParam)

  const handleTabChange = (key) => {
    setActiveTab(key)
    setSearchParams({ tab: key })
  }

  useEffect(() => {
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam])

  // Overview State
  const [overview, setOverview] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(true)
  const [lastRefreshed, setLastRefreshed] = useState(new Date())

  // Volumes State
  const [volumes, setVolumes] = useState([])
  const [loadingVolumes, setLoadingVolumes] = useState(false)

  // Client Nodes State
  const [clientNodes, setClientNodes] = useState([])
  const [loadingClients, setLoadingClients] = useState(false)

  // Repositories & Jobs State
  const [repositories, setRepositories] = useState([])
  const [backupJobs, setBackupJobs] = useState([])
  const [backupHistory, setBackupHistory] = useState([])
  const [loadingBackups, setLoadingBackups] = useState(false)

  // Load Data
  const loadOverviewData = async () => {
    setLoadingOverview(true)
    try {
      const res = await storageAPI.getOverview()
      setOverview(res.data)
      setLastRefreshed(new Date())
    } catch (err) {
      console.error(err)
      message.error('Failed to load storage telemetry')
    } finally {
      setLoadingOverview(false)
    }
  }

  const loadVolumesData = async () => {
    setLoadingVolumes(true)
    try {
      const res = await storageAPI.getVolumes()
      setVolumes(res.data?.volumes || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingVolumes(false)
    }
  }

  const loadClientsData = async () => {
    setLoadingClients(true)
    try {
      const res = await storageAPI.getClients()
      setClientNodes(res.data?.client_nodes || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingClients(false)
    }
  }

  const loadBackupData = async () => {
    setLoadingBackups(true)
    try {
      const [rRes, jRes, hRes] = await Promise.all([
        backupAPI.getRepositories(),
        backupAPI.getJobs(),
        backupAPI.getHistory(),
      ])
      setRepositories(rRes.data || [])
      setBackupJobs(jRes.data || [])
      setBackupHistory(hRes.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingBackups(false)
    }
  }

  useEffect(() => {
    loadOverviewData()
    if (activeTab === 'volumes') loadVolumesData()
    if (activeTab === 'clients') loadClientsData()
    if (activeTab === 'cluster-repo' || activeTab === 'backup-jobs' || activeTab === 'backup-history') loadBackupData()
  }, [activeTab])

  // ---------------------------------------------------------------------------
  // 1. NFS WIZARD STATE
  // ---------------------------------------------------------------------------
  const [wizardStep, setWizardStep] = useState(0)
  const [nfsServerIp, setNfsServerIp] = useState('')
  const [nfsSshUser, setNfsSshUser] = useState('root')
  const [nfsSshPass, setNfsSshPass] = useState('')
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionResult, setConnectionResult] = useState(null)

  const [discoveringStorage, setDiscoveringStorage] = useState(false)
  const [discoveredVols, setDiscoveredVols] = useState([])
  const [selectedVolIds, setSelectedVolIds] = useState([])
  const [exportsConfig, setExportsConfig] = useState([])
  const [selectedClientIps, setSelectedClientIps] = useState([])
  const [clientMountPoints, setClientMountPoints] = useState({})

  const [applyingWizard, setApplyingWizard] = useState(false)
  const [wizardExecutionLogs, setWizardExecutionLogs] = useState([])

  const handleTestNfsConnection = async () => {
    setTestingConnection(true)
    setConnectionResult(null)
    try {
      const res = await storageAPI.testNfsConnection({
        server_ip: nfsServerIp,
        ssh_user: nfsSshUser,
        ssh_password: nfsSshPass || undefined,
      })
      setConnectionResult(res.data)
      if (res.data.success) {
        message.success(`NFS Server ${nfsServerIp} verified successfully`)
      } else {
        message.error(res.data.error || 'Connection failed')
      }
    } catch (err) {
      message.error(err.response?.data?.detail || 'Connection test failed')
    } finally {
      setTestingConnection(false)
    }
  }

  const handleDiscoverStorage = async () => {
    setDiscoveringStorage(true)
    try {
      const res = await storageAPI.discoverNfsStorage({
        server_ip: nfsServerIp,
        ssh_user: nfsSshUser,
        ssh_password: nfsSshPass || undefined,
      })
      const list = res.data?.volumes || []
      setDiscoveredVols(list)
      const rec = list.filter(v => v.is_recommended || v.mount_point === '/home').map(v => v.id)
      setSelectedVolIds(rec)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Storage discovery failed')
    } finally {
      setDiscoveringStorage(false)
    }
  }

  const handleProceedToExports = () => {
    const selected = discoveredVols.filter(v => selectedVolIds.includes(v.id))
    if (selected.length === 0) {
      message.warning('Please select at least one partition or mount point to export')
      return
    }
    const initExports = selected.map(v => ({
      path: v.mount_point,
      allowed_clients: '*',
      access: 'rw',
      root_squash: 'no_root_squash',
      sync_mode: 'sync',
      extra_options: 'no_subtree_check',
    }))
    setExportsConfig(initExports)
    setWizardStep(2)
  }

  const handleProceedToClients = () => {
    const initMnt = {}
    exportsConfig.forEach(exp => {
      initMnt[exp.path] = exp.path
    })
    setClientMountPoints(initMnt)
    setWizardStep(3)
  }

  const handleExecuteNfsWizard = async () => {
    setApplyingWizard(true)
    const logs = []
    setWizardExecutionLogs(logs)

    try {
      logs.push(`[1/3] Applying ${exportsConfig.length} export(s) to NFS Server ${nfsServerIp}...`)
      setWizardExecutionLogs([...logs])

      const expRes = await storageAPI.configureNfsExports({
        server_ip: nfsServerIp,
        exports: exportsConfig,
        ssh_user: nfsSshUser,
        ssh_password: nfsSshPass || undefined,
      })
      logs.push(`  ✓ ${expRes.data.message}`)
      setWizardExecutionLogs([...logs])

      const targets = clientNodes.filter(n => selectedClientIps.includes(n.ip || n.node_ip || n.address))
      logs.push(`[2/3] Configuring ${targets.length} client node(s) with /etc/fstab mounts...`)
      setWizardExecutionLogs([...logs])

      const mountItems = exportsConfig.map(exp => ({
        path: exp.path,
        mount_point: clientMountPoints[exp.path] || exp.path,
        mount_options: 'vers=3,soft,timeo=30,_netdev',
      }))

      const clRes = await storageAPI.configureNfsClients({
        server_ip: nfsServerIp,
        exports_to_mount: mountItems,
        client_nodes: targets,
        ssh_user: nfsSshUser,
        ssh_password: nfsSshPass || undefined,
      })

      clRes.data.nodes.forEach(nd => {
        logs.push(`  • Node ${nd.hostname} (${nd.ip}): ${nd.success ? '✓ SUCCESS' : '✗ FAILED'}`)
        nd.logs.forEach(l => logs.push(`      ${l}`))
      })
      logs.push(`[3/3] NFS Configuration successfully applied and verified across cluster!`)
      setWizardExecutionLogs([...logs])
      message.success('NFS Storage and Client Mounts configured successfully!')
      loadOverviewData()
    } catch (err) {
      logs.push(`[ERROR] ${err.response?.data?.detail || err.message}`)
      setWizardExecutionLogs([...logs])
      message.error('NFS configuration failed')
    } finally {
      setApplyingWizard(false)
    }
  }

  // ---------------------------------------------------------------------------
  // 2. BACKUP JOB CREATION WIZARD (WITH REVIEW STEP)
  // ---------------------------------------------------------------------------
  const [jobModalOpen, setJobModalOpen] = useState(false)
  const [jobWizardStep, setJobWizardStep] = useState(0)
  const [jobForm] = Form.useForm()
  const [jobFormValues, setJobFormValues] = useState({})
  const [savingJob, setSavingJob] = useState(false)
  const [editingJobId, setEditingJobId] = useState(null)

  const handleOpenCreateJob = () => {
    setEditingJobId(null)
    setJobWizardStep(0)
    jobForm.resetFields()
    jobForm.setFieldsValue({
      name: 'HPC Workspace Daily Backup',
      source_node_ip: clientNodes[0]?.ip || clientNodes[0]?.address || '',
      source_directories: '/home, /etc/slurm',
      destination_repo: repositories[0]?.id || 'primary',
      backup_type: 'incremental',
      schedule_type: 'daily',
      schedule_cron: '0 2 * * *',
      start_time: '02:00 UTC',
      retention_full_count: 7,
      retention_inc_count: 14,
      retention_days: 30,
      include_patterns: '*',
      exclude_patterns: '.cache, tmp, *.log',
      compression_level: 'gzip-standard',
      retry_on_failure: true,
      max_retries: 3,
    })
    setJobModalOpen(true)
  }

  const handleOpenEditJob = (job) => {
    setEditingJobId(job.id)
    setJobWizardStep(0)
    jobForm.resetFields()
    jobForm.setFieldsValue({
      name: job.name,
      source_node_ip: job.source_node_ip,
      source_directories: (job.source_directories || []).join(', '),
      destination_repo: job.repo_id || 'primary',
      backup_type: job.backup_type,
      schedule_cron: job.schedule_cron,
      retention_full_count: job.retention_full_count,
      retention_inc_count: job.retention_inc_count,
      retention_days: job.retention_days,
      include_patterns: (job.include_patterns || ['*']).join(', '),
      exclude_patterns: (job.exclude_patterns || ['.cache', 'tmp']).join(', '),
    })
    setJobModalOpen(true)
  }

  const handleProceedJobReview = async () => {
    try {
      const values = await jobForm.validateFields()
      setJobFormValues(values)
      setJobWizardStep(1)
    } catch (err) {}
  }

  const handleSaveJob = async () => {
    setSavingJob(true)
    try {
      const payload = {
        name: jobFormValues.name,
        source_node_ip: jobFormValues.source_node_ip,
        source_directories: jobFormValues.source_directories ? jobFormValues.source_directories.split(',').map(s => s.trim()) : ['/home'],
        backup_type: jobFormValues.backup_type,
        schedule_cron: jobFormValues.schedule_cron,
        retention_full_count: jobFormValues.retention_full_count,
        retention_inc_count: jobFormValues.retention_inc_count,
        retention_days: jobFormValues.retention_days,
        include_patterns: jobFormValues.include_patterns ? jobFormValues.include_patterns.split(',').map(s => s.trim()) : ['*'],
        exclude_patterns: jobFormValues.exclude_patterns ? jobFormValues.exclude_patterns.split(',').map(s => s.trim()) : ['.cache', 'tmp'],
      }

      if (editingJobId) {
        await backupAPI.updateJob(editingJobId, payload)
        message.success('Backup job updated successfully')
      } else {
        await backupAPI.createJob(payload)
        message.success('Backup job created successfully')
      }
      setJobModalOpen(false)
      loadBackupData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to save job')
    } finally {
      setSavingJob(false)
    }
  }

  const handleRunBackupJob = async (jobId) => {
    message.loading({ content: 'Executing backup job...', key: 'backup_run' })
    try {
      const res = await backupAPI.runJob(jobId)
      message.success({ content: res.data.message || 'Backup completed', key: 'backup_run' })
      loadBackupData()
      loadOverviewData()
    } catch (err) {
      message.error({ content: err.response?.data?.detail || 'Backup execution failed', key: 'backup_run' })
    }
  }

  const handleTogglePauseJob = async (jobId) => {
    try {
      const res = await backupAPI.pauseJob(jobId)
      message.success(`Job is now ${res.data.status}`)
      loadBackupData()
    } catch (err) {
      message.error('Failed to change job status')
    }
  }

  const handleDeleteJob = async (jobId) => {
    try {
      await backupAPI.deleteJob(jobId)
      message.success('Backup job deleted')
      loadBackupData()
    } catch (err) {
      message.error('Failed to delete job')
    }
  }

  // ---------------------------------------------------------------------------
  // 3. BACKUP HISTORY FILTERS & RESTORE WIZARD
  // ---------------------------------------------------------------------------
  const [historyFilterType, setHistoryFilterType] = useState('all')
  const [historyFilterStatus, setHistoryFilterStatus] = useState('all')

  const filteredHistory = backupHistory.filter(h => {
    if (historyFilterType !== 'all' && h.backup_type !== historyFilterType) return false
    if (historyFilterStatus !== 'all' && h.status !== historyFilterStatus) return false
    return true
  })

  // Manifest View Modal
  const [manifestModalOpen, setManifestModalOpen] = useState(false)
  const [selectedManifest, setSelectedManifest] = useState(null)

  // Restore Modal
  const [restoreModalOpen, setRestoreModalOpen] = useState(false)
  const [selectedRecoveryPoint, setSelectedRecoveryPoint] = useState(null)
  const [restoreTargetDir, setRestoreTargetDir] = useState('/backup/restored_data')
  const [restoreOverwrite, setRestoreOverwrite] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState(null)

  const handleOpenRestore = (rp) => {
    setSelectedRecoveryPoint(rp)
    setRestoreTargetDir(`/backup/restore_${rp.snapshot_id}`)
    setRestoreResult(null)
    setRestoreModalOpen(true)
  }

  const handleExecuteRestore = async () => {
    if (!selectedRecoveryPoint) return
    setRestoring(true)
    try {
      const res = await backupAPI.restore({
        recovery_point_id: selectedRecoveryPoint.id,
        target_directory: restoreTargetDir,
        overwrite: restoreOverwrite,
      })
      setRestoreResult(res.data)
      if (res.data.success) {
        message.success(res.data.message)
      } else if (res.data.has_conflicts) {
        message.warning(res.data.conflict_warning)
      }
    } catch (err) {
      message.error(err.response?.data?.detail || 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  // ---------------------------------------------------------------------------
  // NAVIGATION TABS SPECIFICATION (7 DIRECT TABS)
  // ---------------------------------------------------------------------------
  const navTabs = [
    { key: 'overview', label: 'Storage Overview', icon: <HddOutlined /> },
    { key: 'apps-automation', label: 'Apps & NFS Automation', icon: <ToolOutlined /> },
    { key: 'nfs-wizard', label: 'NFS Configuration', icon: <CloudServerOutlined /> },
    { key: 'volumes', label: 'Storage Volumes', icon: <DatabaseOutlined /> },
    { key: 'clients', label: 'Client Nodes', icon: <CloudServerOutlined /> },
    { key: 'backup-storage', label: 'Backup Storage', icon: <SafetyCertificateOutlined /> },
    { key: 'backup-jobs', label: 'Backup Jobs', icon: <PlayCircleOutlined /> },
    { key: 'backup-history', label: 'Backup History', icon: <SyncOutlined /> },
  ]

  // Calculated Metrics for Circular Charts
  const totalGb = overview?.summary?.total_capacity_gb ?? 0
  const usedGb = overview?.summary?.used_capacity_gb ?? 0
  const availGb = overview?.summary?.available_capacity_gb ?? (Math.max(0, totalGb - usedGb))
  const usagePct = overview?.summary?.usage_percentage ?? 0

  const configuredMounts = overview?.summary?.client_mounts_count ?? 0
  const activeMounts = overview?.summary?.client_mounts_count ?? 0
  const failedMounts = overview?.summary?.failed_mounts_count ?? 0
  const mountsPct = configuredMounts > 0 ? Math.round((activeMounts / configuredMounts) * 100) : 0

  const repoTotal = overview?.backup_repository?.total_gb ?? 0
  const repoFree = overview?.backup_repository?.free_gb ?? 0
  const repoUsed = Math.max(0, repoTotal - repoFree)
  const repoPct = repoTotal > 0 ? Math.round((repoUsed / repoTotal) * 100) : 0

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      {/* ── 1. STORAGE MODULE NAVIGATION TABS (Direct, No Dropdowns, Responsive Scroll) ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflowX: 'auto',
        whiteSpace: 'nowrap',
        padding: '4px 0 12px 0',
        marginBottom: 16,
        borderBottom: '1px solid #E2E8F0',
        scrollbarWidth: 'thin',
        WebkitOverflowScrolling: 'touch',
      }}>
        {navTabs.map((t) => {
          const isActive = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 16px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                background: isActive ? '#2563EB' : '#FFFFFF',
                color: isActive ? '#FFFFFF' : '#475569',
                border: isActive ? '1px solid #2563EB' : '1px solid #CBD5E1',
                boxShadow: isActive ? '0 1px 3px rgba(37,99,235,0.25)' : 'none',
                flexShrink: 0,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = '#94A3B8'
                  e.currentTarget.style.color = '#1E293B'
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.borderColor = '#CBD5E1'
                  e.currentTarget.style.color = '#475569'
                }
              }}
            >
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>

      {/* ── 2. TAB CONTENT: STORAGE OVERVIEW (4 CIRCULAR DONUT CHARTS) ── */}
      {activeTab === 'overview' && (
        <div>
          {loadingOverview ? (
            <div style={{ textAlign: 'center', padding: 80 }}><div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}><Spin size="large" /><span style={{ color: "#64748B", fontSize: 13 }}>Collecting real cluster storage telemetry...</span></div></div>
          ) : (
            <div>
              {/* Four Summary Cards Grid */}
              <Row gutter={[16, 16]}>
                {/* CARD 1: TOTAL CAPACITY */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    style={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                      Total Capacity
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 16 }}>
                      Overall storage capacity across cluster nodes and configured repositories.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '4px 8px' }}>
                      <Progress
                        type="circle"
                        percent={usagePct}
                        size={110}
                        strokeWidth={10}
                        strokeColor="#2563EB"
                        trailColor="#E2E8F0"
                        format={(pct) => (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>{pct}%</div>
                            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', marginTop: 2 }}>USED</div>
                          </div>
                        )}
                      />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563EB', display: 'inline-block' }} />
                            <span>Total Pool Capacity</span>
                          </span>
                          <span style={{ fontWeight: 800, color: '#0F172A' }}>{totalGb} GB</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                            <span>Available Free</span>
                          </span>
                          <span style={{ fontWeight: 700, color: '#10B981' }}>{availGb} GB</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                          Spans monitored cluster storage pools and client mounts.
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>

                {/* CARD 2: USED STORAGE */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    style={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                      Used Storage
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 16 }}>
                      Actual used capacity, available capacity, and utilization percentage.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '4px 8px' }}>
                      <Progress
                        type="circle"
                        percent={usagePct}
                        size={110}
                        strokeWidth={10}
                        strokeColor="#3B82F6"
                        trailColor="#E2E8F0"
                        format={() => (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>{usedGb}</div>
                            <div style={{ fontSize: 10, color: '#64748B', textTransform: 'uppercase', marginTop: 2 }}>GB USED</div>
                          </div>
                        )}
                      />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#3B82F6', display: 'inline-block' }} />
                            <span>Currently Consumed</span>
                          </span>
                          <span style={{ fontWeight: 800, color: '#0F172A' }}>{usedGb} GB</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#E2E8F0', display: 'inline-block' }} />
                            <span>Unallocated Headroom</span>
                          </span>
                          <span style={{ fontWeight: 700, color: '#64748B' }}>{availGb} GB</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 4 }}>
                          {totalGb === 0 ? 'No storage pools detected across cluster nodes.' : `Storage consumption is healthy (${usagePct}% total utilization).`}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>

                {/* CARD 3: NFS EXPORTS & MOUNTS */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    style={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                      NFS Exports & Mounts
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 16 }}>
                      Active exports, configured client mounts, and failed mounts.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '4px 8px' }}>
                      <Progress
                        type="circle"
                        percent={mountsPct}
                        size={110}
                        strokeWidth={10}
                        strokeColor="#16A34A"
                        trailColor="#E2E8F0"
                        format={() => (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#16A34A', lineHeight: 1.1 }}>{activeMounts}/{configuredMounts}</div>
                            <div style={{ fontSize: 9.5, color: '#64748B', textTransform: 'uppercase', marginTop: 2 }}>ACTIVE</div>
                          </div>
                        )}
                      />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Server Active Exports</span>
                          <Tag color={overview?.nfs_exports && overview.nfs_exports.length > 0 ? "blue" : "default"}>
                            {overview?.nfs_exports && overview.nfs_exports.length > 0
                              ? `${overview.nfs_exports.length} Exports (${overview.nfs_exports.map(e => e.path || e).join(', ')})`
                              : '0 Exports Configured'}
                          </Tag>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Client Node Mounts</span>
                          <Tag color={configuredMounts > 0 ? "green" : "default"}>{activeMounts} Active / {configuredMounts} Configured</Tag>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Failed Mounts</span>
                          {failedMounts === 0 ? (
                            <Tag color="success">✓ 0 Failed Mounts</Tag>
                          ) : (
                            <Tag color="error">{failedMounts} Failed Mounts</Tag>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>

                {/* CARD 4: BACKUP REPOSITORY */}
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    style={{ borderRadius: 8, border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)' }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 2 }}>
                      Backup Repository
                    </div>
                    <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 16 }}>
                      Repository capacity, used space, free space, and backup health.
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '4px 8px' }}>
                      <Progress
                        type="circle"
                        percent={repoPct}
                        size={110}
                        strokeWidth={10}
                        strokeColor="#6366F1"
                        trailColor="#E2E8F0"
                        format={(pct) => (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>{repoFree}G</div>
                            <div style={{ fontSize: 9.5, color: '#64748B', textTransform: 'uppercase', marginTop: 2 }}>FREE SPACE</div>
                          </div>
                        )}
                      />
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Target Storage Path</span>
                          <Text code strong>/backup</Text>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Free Space / Total</span>
                          <span style={{ fontWeight: 700 }}>{repoFree} GB of {repoTotal} GB</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                          <span>Repository Health</span>
                          {repoTotal > 0 ? (
                            <Tag color="green">✓ Healthy</Tag>
                          ) : (
                            <Tag color="default">Unconfigured</Tag>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Node-Level Filesystem Utilization */}
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>Node-Level Filesystem Telemetry</div>
                    <div style={{ fontSize: 12, color: '#64748B' }}>Last collected: {lastRefreshed.toLocaleTimeString()}</div>
                  </div>
                  <Button size="small" icon={<ReloadOutlined />} onClick={loadOverviewData}>Refresh Telemetry</Button>
                </div>

                <Row gutter={[16, 16]}>
                  {overview?.nodes_utilization?.map(node => (
                    <Col xs={24} lg={12} key={node.ip}>
                      <Card
                        title={
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Space>
                              <CloudServerOutlined style={{ color: '#2563EB' }} />
                              <Text strong>{node.hostname} ({node.ip})</Text>
                              <Tag color={node.status === 'online' ? 'green' : (node.status === 'degraded' || node.status === 'connecting') ? 'orange' : 'red'}>
                                {node.status ? node.status.toUpperCase() : 'OFFLINE'}
                              </Tag>
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12 }}>{node.role}</Text>
                          </div>
                        }
                        size="small"
                        style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}
                      >
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <span>Total Storage Used:</span>
                            <span style={{ fontWeight: 700 }}>{node.used_gb} GB of {node.total_gb} GB ({node.usage_pct}%)</span>
                          </div>
                          <Progress percent={node.usage_pct} strokeColor="#2563EB" />
                        </div>

                        <Table
                          size="small"
                          pagination={false}
                          dataSource={node.mounts}
                          rowKey="mount_point"
                          columns={[
                            { title: 'Mount Point', dataIndex: 'mount_point', key: 'mp', render: (t, r) => (
                              <div>
                                <Text strong code>{t}</Text>
                                {r.is_nfs_exported && <Tag color="blue" style={{ marginLeft: 6, fontSize: 10 }}>NFS EXPORT</Tag>}
                              </div>
                            )},
                            { title: 'FS', dataIndex: 'filesystem', key: 'fs', width: 70 },
                            { title: 'Size', dataIndex: 'size', key: 'sz', width: 70 },
                            { title: 'Used', dataIndex: 'used', key: 'u', width: 70 },
                            { title: 'Usage', dataIndex: 'use_pct', key: 'pct', width: 90, render: (v) => (
                              <Progress percent={v} size="small" strokeColor={v > 85 ? '#DC2626' : '#2563EB'} />
                            )},
                          ]}
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── APPS PARTITION & NFS AUTOMATION WIZARD ── */}
      {activeTab === 'apps-automation' && (
        <AppsStorageWizard />
      )}

      {/* ── 3. TAB CONTENT: NFS CONFIGURATION (5-STEP WIZARD) ── */}
      {activeTab === 'nfs-wizard' && (
        <Card
          size="small"
          title={<span style={{ fontWeight: 700, fontSize: 16 }}>Agent-Based NFS Server & Client Configuration</span>}
          style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}
        >
          {/* Steps Indicator */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 28, borderBottom: '1px solid #E2E8F0', paddingBottom: 16 }}>
            {['1. Connect Server', '2. Discover Storage', '3. Configure Exports', '4. Configure Clients', '5. Review & Apply'].map((label, idx) => (
              <div
                key={label}
                onClick={() => { if (idx < wizardStep) setWizardStep(idx) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  cursor: idx < wizardStep ? 'pointer' : 'default',
                  color: idx === wizardStep ? '#2563EB' : (idx < wizardStep ? '#16A34A' : '#94A3B8'),
                  fontWeight: idx === wizardStep ? 700 : 500,
                }}
              >
                <span style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: idx === wizardStep ? '#2563EB' : (idx < wizardStep ? '#16A34A' : '#E2E8F0'),
                  color: idx <= wizardStep ? '#fff' : '#64748B',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700
                }}>
                  {idx < wizardStep ? '✓' : idx + 1}
                </span>
                <span>{label}</span>
              </div>
            ))}
          </div>

          {/* Step 1: Connect to NFS Server */}
          {wizardStep === 0 && (
            <div style={{ maxWidth: 700, margin: '0 auto' }}>
              <Title level={5} style={{ marginBottom: 4 }}>Step 1: Connect to NFS Server Node</Title>
              <Paragraph type="secondary" style={{ fontSize: 12.5 }}>
                Authenticate with the cluster storage controller via SSH. The agent will verify administrative root privileges, package status, and firewall readiness.
              </Paragraph>

              <Form layout="vertical">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item label="NFS Server IP / FQDN" required>
                      <Input value={nfsServerIp} onChange={(e) => setNfsServerIp(e.target.value)} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label="SSH Username" required>
                      <Input value={nfsSshUser} onChange={(e) => setNfsSshUser(e.target.value)} />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item label="Root Password (Secure Memory Execution)">
                  <Input.Password
                    placeholder="Enter server root password"
                    value={nfsSshPass}
                    onChange={(e) => setNfsSshPass(e.target.value)}
                  />
                </Form.Item>

                <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
                  <Button type="primary" onClick={handleTestNfsConnection} loading={testingConnection} icon={<SyncOutlined />}>
                    Test Connection & Inspect Agent
                  </Button>
                </div>
              </Form>

              {connectionResult && (
                <div style={{ marginTop: 20 }}>
                  <Alert
                    type={connectionResult.success ? 'success' : 'error'}
                    showIcon
                    message={connectionResult.success ? 'NFS Server Verified' : 'Connection Failed'}
                    description={
                      connectionResult.success ? (
                        <div style={{ fontSize: 12.5, marginTop: 6 }}>
                          <div><strong>Host:</strong> {connectionResult.hostname} ({connectionResult.ip}) | <strong>OS:</strong> {connectionResult.os}</div>
                          <div><strong>Privileges:</strong> {connectionResult.privileges} | <strong>Latency:</strong> {connectionResult.latency_ms} ms</div>
                          <div><strong>NFS Package:</strong> {connectionResult.nfs_package_version} | <strong>Service:</strong> {connectionResult.nfs_service_active ? 'Running' : 'Inactive'}</div>
                        </div>
                      ) : connectionResult.error
                    }
                  />

                  {connectionResult.success && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
                      <Button
                        type="primary"
                        onClick={() => {
                          setWizardStep(1)
                          handleDiscoverStorage()
                        }}
                      >
                        Next: Discover Storage &rarr;
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Discover Storage */}
          {wizardStep === 1 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <Title level={5} style={{ marginBottom: 2 }}>Step 2: Discovered Storage Devices & Partitions</Title>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Select the partitions and mount points to export as shared cluster storage. Existing exports are detected automatically.
                  </Text>
                </div>
                <Button size="small" icon={<ReloadOutlined />} onClick={handleDiscoverStorage} loading={discoveringStorage}>
                  Re-scan
                </Button>
              </div>

              <Table
                size="small"
                rowSelection={{
                  selectedRowKeys: selectedVolIds,
                  onChange: setSelectedVolIds,
                }}
                dataSource={discoveredVols}
                rowKey="id"
                loading={discoveringStorage}
                columns={[
                  { title: 'Device', dataIndex: 'device', key: 'dev', render: (t) => <Text code>{t}</Text> },
                  { title: 'Mount Point', dataIndex: 'mount_point', key: 'mp', render: (t, r) => (
                    <div>
                      <Text strong>{t}</Text>
                      {r.is_recommended && <Tag color="green" style={{ marginLeft: 6, fontSize: 10 }}>RECOMMENDED</Tag>}
                    </div>
                  )},
                  { title: 'Filesystem', dataIndex: 'filesystem', key: 'fs' },
                  { title: 'Total', dataIndex: 'total_capacity', key: 'tot' },
                  { title: 'Used', dataIndex: 'used_capacity', key: 'u' },
                  { title: 'Available', dataIndex: 'available_capacity', key: 'av' },
                  { title: 'NFS Export Status', dataIndex: 'is_exported', key: 'exp', render: (v) => (
                    v ? <Tag color="blue">✓ Already Exported</Tag> : <Tag color="default">Available for Export</Tag>
                  )},
                ]}
              />

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                <Button onClick={() => setWizardStep(0)}>&larr; Back</Button>
                <Button type="primary" onClick={handleProceedToExports}>
                  Next: Configure Exports &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Configure NFS Exports */}
          {wizardStep === 2 && (
            <div>
              <Title level={5} style={{ marginBottom: 2 }}>Step 3: Configure Export Permissions & Security</Title>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Configure client network access rules, root squash policies, and synchronization behavior for each selected export.
              </Paragraph>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {exportsConfig.map((exp, idx) => (
                  <Card key={exp.path} size="small" title={<Text strong>Export: {exp.path}</Text>} style={{ border: '1px solid #CBD5E1' }}>
                    <Row gutter={16}>
                      <Col span={6}>
                        <Form.Item label="Allowed Clients (CIDR / Host)">
                          <Input
                            value={exp.allowed_clients}
                            onChange={(e) => {
                              const up = [...exportsConfig]
                              up[idx].allowed_clients = e.target.value
                              setExportsConfig(up)
                            }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item label="Access Mode">
                          <Select
                            value={exp.access}
                            onChange={(val) => {
                              const up = [...exportsConfig]
                              up[idx].access = val
                              setExportsConfig(up)
                            }}
                          >
                            <Option value="rw">Read-Write (rw)</Option>
                            <Option value="ro">Read-Only (ro)</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item label="Root Squash Policy">
                          <Select
                            value={exp.root_squash}
                            onChange={(val) => {
                              const up = [...exportsConfig]
                              up[idx].root_squash = val
                              setExportsConfig(up)
                            }}
                          >
                            <Option value="no_root_squash">no_root_squash (Admin Access)</Option>
                            <Option value="root_squash">root_squash (Squash root)</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item label="Sync Behavior">
                          <Select
                            value={exp.sync_mode}
                            onChange={(val) => {
                              const up = [...exportsConfig]
                              up[idx].sync_mode = val
                              setExportsConfig(up)
                            }}
                          >
                            <Option value="sync">Synchronous (sync)</Option>
                            <Option value="async">Asynchronous (async)</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                      <Col span={5}>
                        <Form.Item label="Subtree Check">
                          <Select
                            value={exp.extra_options}
                            onChange={(val) => {
                              const up = [...exportsConfig]
                              up[idx].extra_options = val
                              setExportsConfig(up)
                            }}
                          >
                            <Option value="no_subtree_check">no_subtree_check (Recommended)</Option>
                            <Option value="subtree_check">subtree_check</Option>
                          </Select>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                <Button onClick={() => setWizardStep(1)}>&larr; Back</Button>
                <Button type="primary" onClick={handleProceedToClients}>
                  Next: Configure Client Nodes &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* Step 4: Configure Client Nodes */}
          {wizardStep === 3 && (
            <div>
              <Title level={5} style={{ marginBottom: 2 }}>Step 4: Configure Client Node Mount Points</Title>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Select the cluster worker nodes that should mount these NFS shares. The agent will ensure nfs-utils is installed, create mount points, and configure persistent /etc/fstab entries.
              </Paragraph>

              <Card size="small" title="Registered Cluster Nodes" style={{ marginBottom: 16 }}>
                <Checkbox.Group
                  value={selectedClientIps}
                  onChange={setSelectedClientIps}
                  style={{ width: '100%' }}
                >
                  <Row gutter={16}>
                    {clientNodes.map(n => (
                      <Col span={12} key={n.id || n.ip || n.node_ip}>
                        <Checkbox value={n.ip || n.node_ip || n.address}>
                          <Text strong>{n.hostname || n.node_hostname}</Text> ({n.ip || n.node_ip || n.address})
                        </Checkbox>
                      </Col>
                    ))}
                    {clientNodes.length === 0 && (
                      <Col span={24} style={{ color: '#94A3B8', fontSize: 13, padding: 8 }}>
                        No client nodes enrolled yet. Add nodes in Node Management to configure client NFS mounts.
                      </Col>
                    )}
                  </Row>
                </Checkbox.Group>
              </Card>

              <Card size="small" title="Client Mount Points Mapping">
                <Row gutter={16}>
                  {exportsConfig.map(exp => (
                    <Col span={12} key={exp.path}>
                      <Form.Item label={`Mount point for export ${exp.path}`}>
                        <Input
                          value={clientMountPoints[exp.path] || exp.path}
                          onChange={(e) => {
                            setClientMountPoints({
                              ...clientMountPoints,
                              [exp.path]: e.target.value
                            })
                          }}
                        />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              </Card>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                <Button onClick={() => setWizardStep(2)}>&larr; Back</Button>
                <Button type="primary" onClick={() => setWizardStep(4)}>
                  Next: Review & Apply &rarr;
                </Button>
              </div>
            </div>
          )}

          {/* Step 5: Review & Apply */}
          {wizardStep === 4 && (
            <div>
              <Title level={5} style={{ marginBottom: 2 }}>Step 5: Review & Apply Storage Configuration</Title>
              <Paragraph type="secondary" style={{ fontSize: 12 }}>
                Verify configuration before applying changes. The agent will backup /etc/exports, reload the NFS daemon, and mount shares on client nodes.
              </Paragraph>

              <Row gutter={16}>
                <Col span={12}>
                  <Card size="small" title="NFS Server & Exports Summary">
                    <div><strong>Server:</strong> {nfsServerIp} (mas)</div>
                    <div style={{ marginTop: 8 }}><strong>Exports to Apply ({exportsConfig.length}):</strong></div>
                    <ul style={{ paddingLeft: 20, marginTop: 4 }}>
                      {exportsConfig.map(e => (
                        <li key={e.path}>
                          <Text code strong>{e.path}</Text> &rarr; {e.allowed_clients} ({e.access}, {e.root_squash})
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Col>

                <Col span={12}>
                  <Card size="small" title="Client Nodes & Mount Points">
                    <div><strong>Target Nodes:</strong> {selectedClientIps.join(', ') || 'None selected'}</div>
                    <div style={{ marginTop: 8 }}><strong>Mount Mappings:</strong></div>
                    <ul style={{ paddingLeft: 20, marginTop: 4 }}>
                      {Object.entries(clientMountPoints).map(([src, dst]) => (
                        <li key={src}>
                          {nfsServerIp}:{src} &rarr; <Text code strong>{dst}</Text>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </Col>
              </Row>

              {wizardExecutionLogs.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Execution Logs:</div>
                  <div style={{
                    background: '#0F172A', color: '#F1F5F9', padding: '12px 16px',
                    borderRadius: 6, maxHeight: 240, overflowY: 'auto',
                    fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6
                  }}>
                    {wizardExecutionLogs.map((log, idx) => (
                      <div key={idx}>{log}</div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                <Button onClick={() => setWizardStep(3)} disabled={applyingWizard}>&larr; Back</Button>
                <Button
                  type="primary"
                  onClick={handleExecuteNfsWizard}
                  loading={applyingWizard}
                  style={{ background: '#16A34A', borderColor: '#16A34A', fontWeight: 700 }}
                >
                  ✓ Apply NFS Configuration & Synchronize Cluster
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ── 4. TAB CONTENT: STORAGE VOLUMES ── */}
      {activeTab === 'volumes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Discovered Cluster Block Devices & Partitions</div>
            <Button icon={<ReloadOutlined />} onClick={loadVolumesData} loading={loadingVolumes}>Refresh Volumes</Button>
          </div>
          <Table
            size="small"
            dataSource={volumes}
            rowKey={(r) => `${r.node_ip}-${r.device}`}
            loading={loadingVolumes}
            columns={[
              { title: 'Node', dataIndex: 'node_hostname', key: 'nh', render: (n, r) => <Tag color="blue">{n} ({r.node_ip})</Tag> },
              { title: 'Device', dataIndex: 'device', key: 'dev', render: (t) => <Text code strong>{t}</Text> },
              { title: 'Mount Point', dataIndex: 'mount_point', key: 'mp', render: (t) => <Text strong>{t}</Text> },
              { title: 'Filesystem', dataIndex: 'filesystem', key: 'fs' },
              { title: 'Total', dataIndex: 'total_capacity', key: 'tot' },
              { title: 'Used', dataIndex: 'used_capacity', key: 'u' },
              { title: 'Available', dataIndex: 'available_capacity', key: 'av' },
              { title: 'Usage', dataIndex: 'use_pct', key: 'pct', render: (v) => (
                <Progress percent={parseInt(v) || 0} size="small" />
              )},
              { title: 'NFS Export', dataIndex: 'is_exported', key: 'exp', render: (v) => v ? <Tag color="green">✓ Exported</Tag> : <Tag color="default">Local</Tag> },
            ]}
          />
        </div>
      )}

      {/* ── 5. TAB CONTENT: CLIENT NODES ── */}
      {activeTab === 'clients' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Cluster Client Nodes & NFS Mount Status</div>
            <Button icon={<ReloadOutlined />} onClick={loadClientsData} loading={loadingClients}>Re-check Clients</Button>
          </div>
          <Table
            size="small"
            dataSource={clientNodes}
            rowKey={(r) => `${r.node_ip}-${r.mount_point}`}
            loading={loadingClients}
            columns={[
              { title: 'Hostname', dataIndex: 'node_hostname', key: 'nh', render: (n) => <Text strong>{n}</Text> },
              { title: 'Node IP', dataIndex: 'node_ip', key: 'ip' },
              { title: 'Mount Point', dataIndex: 'mount_point', key: 'mp', render: (t) => <Text code strong>{t}</Text> },
              { title: 'Remote Export', dataIndex: 'remote_export', key: 're' },
              { title: 'FS Type', dataIndex: 'fs_type', key: 'fst' },
              { title: 'Status', dataIndex: 'status', key: 'st', render: () => <Tag color="green">✓ Active</Tag> },
              { title: 'Persistent (/etc/fstab)', dataIndex: 'is_fstab_persisted', key: 'p', render: (v) => v ? <Tag color="cyan">Yes</Tag> : <Tag color="orange">Temporary</Tag> },
            ]}
          />
        </div>
      )}

      {/* ── 6. TAB CONTENT: BACKUP STORAGE / REPOSITORY ── */}
      {(activeTab === 'backup-storage' || activeTab === 'cluster-repo') && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Cluster Storage Repository Configuration</div>
              <div style={{ fontSize: 12.5, color: '#64748B' }}>Configure backup destinations, monitor capacity, and set retention rules.</div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => message.info('Primary cluster repository is actively managed at /backup')}>
              + Register Repository
            </Button>
          </div>

          <Row gutter={[16, 16]}>
            {repositories.map(repo => (
              <Col xs={24} md={12} key={repo.id}>
                <Card size="small" title={<Text strong>{repo.name}</Text>} style={{ borderRadius: 8, border: '1px solid #CBD5E1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
                    <Progress
                      type="circle"
                      percent={parseInt(repo.usage_pct) || 10}
                      size={90}
                      strokeColor="#6366F1"
                      format={() => `${repo.available_gb}G Free`}
                    />
                    <div style={{ flex: 1, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div><strong>Repository Server:</strong> {repo.server_ip}</div>
                      <div><strong>Destination Path:</strong> <Text code>{repo.path}</Text></div>
                      <div><strong>Protocol:</strong> <Tag color="blue">{repo.protocol.toUpperCase()}</Tag></div>
                      <div><strong>Health Status:</strong> <Tag color="green">✓ {repo.status.toUpperCase()}</Tag></div>
                      <div><strong>Total / Used:</strong> {repo.total_gb} GB / {repo.used_gb} GB</div>
                    </div>
                  </div>

                  <Divider style={{ margin: '12px 0' }} />
                  <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 6 }}>RETENTION & CLEANUP POLICY:</div>
                  <div style={{ fontSize: 12, color: '#334155', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div>• <strong>Retain Full Backups:</strong> 7 full copies</div>
                    <div>• <strong>Retain Incremental Backups:</strong> 14 incremental copies</div>
                    <div>• <strong>Cleanup Protection:</strong> Never deletes full backup if dependent incremental chains exist</div>
                    <div>• <strong>Maximum Repo Usage:</strong> 85% storage threshold with automated alerts</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      )}

      {/* ── 7. TAB CONTENT: BACKUP JOBS ── */}
      {activeTab === 'backup-jobs' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Backup Jobs Management</div>
              <div style={{ fontSize: 12.5, color: '#64748B' }}>Manage scheduled and manual backup jobs across cluster nodes and shared storage.</div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenCreateJob}>
              + Create Backup Job
            </Button>
          </div>

          <Table
            size="small"
            dataSource={backupJobs}
            rowKey="id"
            loading={loadingBackups}
            columns={[
              { title: 'Job Name & ID', key: 'nm', render: (_, r) => (
                <div>
                  <Text strong>{r.name}</Text>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{r.id}</div>
                </div>
              )},
              { title: 'Source', key: 'src', render: (_, r) => (
                <div>
                  <Text strong>{r.source_node_ip}:</Text>
                  <div style={{ fontSize: 11 }}>{(r.source_directories || []).join(', ')}</div>
                </div>
              )},
              { title: 'Type', dataIndex: 'backup_type', key: 'bt', render: (t) => (
                <Tag color={t === 'full' ? 'blue' : 'green'}>{t.toUpperCase()}</Tag>
              )},
              { title: 'Schedule', dataIndex: 'schedule_cron', key: 'sc', render: (c) => <Text code>{c}</Text> },
              { title: 'Status', dataIndex: 'status', key: 'st', render: (s, r) => (
                <Tag color={s === 'running' ? 'processing' : s === 'paused' ? 'orange' : 'green'}>
                  {s.toUpperCase()}
                </Tag>
              )},
              { title: 'Last Run', dataIndex: 'last_run', key: 'lr', render: (d) => d ? new Date(d).toLocaleString() : 'Never' },
              {
                title: 'Actions',
                key: 'act',
                render: (_, r) => (
                  <Space size="small">
                    <Tooltip title="Run Immediately">
                      <Button size="small" type="primary" icon={<PlayCircleOutlined />} onClick={() => handleRunBackupJob(r.id)} />
                    </Tooltip>
                    <Tooltip title={r.is_active ? 'Pause Schedule' : 'Resume Schedule'}>
                      <Button size="small" icon={r.is_active ? <PauseCircleOutlined /> : <PlayCircleOutlined />} onClick={() => handleTogglePauseJob(r.id)} />
                    </Tooltip>
                    <Tooltip title="Edit Job">
                      <Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEditJob(r)} />
                    </Tooltip>
                    <Popconfirm title="Delete backup job?" onConfirm={() => handleDeleteJob(r.id)} okText="Delete" cancelText="Cancel">
                      <Button size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ── 8. TAB CONTENT: BACKUP HISTORY ── */}
      {activeTab === 'backup-history' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Backup History Catalog</div>
              <div style={{ fontSize: 12.5, color: '#64748B' }}>Catalog of completed and verified recovery points stored across repositories.</div>
            </div>
            <Button icon={<ReloadOutlined />} onClick={loadBackupData}>Refresh Catalog</Button>
          </div>

          {/* Filter Bar */}
          <Card size="small" style={{ marginBottom: 14, borderRadius: 8, background: '#F8FAFC' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}><FilterOutlined /> FILTERS:</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12 }}>Backup Type:</span>
                <Select value={historyFilterType} onChange={setHistoryFilterType} size="small" style={{ width: 140 }}>
                  <Option value="all">All Types</Option>
                  <Option value="full">Full Backup</Option>
                  <Option value="incremental">Incremental</Option>
                </Select>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12 }}>Status:</span>
                <Select value={historyFilterStatus} onChange={setHistoryFilterStatus} size="small" style={{ width: 140 }}>
                  <Option value="all">All Statuses</Option>
                  <Option value="completed">Completed</Option>
                  <Option value="failed">Failed</Option>
                </Select>
              </div>
            </div>
          </Card>

          <Table
            size="small"
            dataSource={filteredHistory}
            rowKey="id"
            loading={loadingBackups}
            columns={[
              { title: 'Snapshot / Backup ID', dataIndex: 'snapshot_id', key: 'sid', render: (t) => <Text code strong>{t}</Text> },
              { title: 'Chain ID', dataIndex: 'chain_id', key: 'cid', render: (c) => <Tag color="geekblue">{c}</Tag> },
              { title: 'Type', dataIndex: 'backup_type', key: 'bt', render: (t) => (
                <Tag color={t === 'full' ? 'blue' : 'green'}>{t === 'full' ? 'FULL' : 'INCREMENTAL (Hardlinked)'}</Tag>
              )},
              { title: 'Repository', dataIndex: 'repo_path', key: 'rp', ellipsis: true },
              { title: 'Total Size', dataIndex: 'total_size_mb', key: 'sz', render: (s) => `${s} MB` },
              { title: 'Deduplication', dataIndex: 'compression_ratio', key: 'cr', render: (c) => <Tag color="cyan">{c}</Tag> },
              { title: 'Completed', dataIndex: 'completed_at', key: 'ca', render: (d) => d ? new Date(d).toLocaleString() : '' },
              { title: 'Status', dataIndex: 'status', key: 'st', render: () => <Tag color="green">✓ Completed</Tag> },
              { title: 'Verification', key: 'ver', render: () => <Tag color="success">✓ Verified</Tag> },
              {
                title: 'Actions',
                key: 'act',
                render: (_, r) => (
                  <Space size="small">
                    <Button size="small" type="default" icon={<EyeOutlined />} onClick={() => { setSelectedManifest(r); setManifestModalOpen(true) }}>
                      Manifest
                    </Button>
                    <Button size="small" type="primary" icon={<RollbackOutlined />} onClick={() => handleOpenRestore(r)}>
                      Restore...
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </div>
      )}

      {/* ── BACKUP JOB CREATION MODAL WITH CONFIGURATION REVIEW STEP ── */}
      <Modal
        title={editingJobId ? "Edit Backup Job" : "Create Backup Job — Multi-Step Wizard"}
        open={jobModalOpen}
        onCancel={() => setJobModalOpen(false)}
        footer={null}
        width={700}
      >
        <Steps
          current={jobWizardStep}
          size="small"
          items={[
            { title: 'Configuration' },
            { title: 'Review & Confirm' },
          ]}
          style={{ marginBottom: 20 }}
        />

        {jobWizardStep === 0 && (
          <Form form={jobForm} layout="vertical">
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item name="name" label="Job Name" rules={[{ required: true, message: 'Please provide a job name' }]}>
                  <Input placeholder="e.g. HPC Workspace Daily Backup" />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="source_node_ip" label="Cluster Source Node" rules={[{ required: true }]}>
                  <Select placeholder="Select source node...">
                    {clientNodes.map(n => (
                      <Option key={n.id || n.ip || n.node_ip} value={n.ip || n.node_ip || n.address}>
                        {n.hostname || n.node_hostname} ({n.ip || n.node_ip || n.address})
                      </Option>
                    ))}
                    {clientNodes.length === 0 && (
                      <Option value="">Local Controller</Option>
                    )}
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="source_directories" label="Source Directories (comma-separated)" rules={[{ required: true }]}>
              <Input placeholder="/home, /etc/slurm, /apps" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="backup_type" label="Backup Strategy">
                  <Select>
                    <Option value="incremental">Incremental (Hardlink Deduplication via --link-dest)</Option>
                    <Option value="full">Always Full Copy</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="schedule_cron" label="Schedule (Cron Expression)">
                  <Input placeholder="0 2 * * * (Daily at 02:00 AM)" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="retention_full_count" label="Retain Full Copies">
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="retention_inc_count" label="Retain Incremental Copies">
                  <InputNumber min={1} max={60} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="exclude_patterns" label="Exclude Patterns">
              <Input placeholder=".cache, tmp, *.log" />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              <Button onClick={() => setJobModalOpen(false)}>Cancel</Button>
              <Button type="primary" onClick={handleProceedJobReview}>
                Proceed to Review &rarr;
              </Button>
            </div>
          </Form>
        )}

        {jobWizardStep === 1 && (
          <div>
            <Alert
              type="info"
              showIcon
              message="Configuration Review Before Saving"
              description="Review backup parameters, source directories, and retention rules before registering the backup job."
              style={{ marginBottom: 16 }}
            />

            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="Job Name">{jobFormValues.name}</Descriptions.Item>
              <Descriptions.Item label="Cluster Source Node">{jobFormValues.source_node_ip}</Descriptions.Item>
              <Descriptions.Item label="Source Directories">{jobFormValues.source_directories}</Descriptions.Item>
              <Descriptions.Item label="Destination Repository">/backup (Local POSIX / NFS)</Descriptions.Item>
              <Descriptions.Item label="Backup Strategy">
                <Tag color={jobFormValues.backup_type === 'full' ? 'blue' : 'green'}>
                  {jobFormValues.backup_type?.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Schedule (Cron)"><code>{jobFormValues.schedule_cron}</code></Descriptions.Item>
              <Descriptions.Item label="Retention Policy">
                {jobFormValues.retention_full_count} Full Copies / {jobFormValues.retention_inc_count} Incremental Copies
              </Descriptions.Item>
              <Descriptions.Item label="Exclude Patterns"><code>{jobFormValues.exclude_patterns || 'None'}</code></Descriptions.Item>
            </Descriptions>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
              <Button onClick={() => setJobWizardStep(0)} disabled={savingJob}>&larr; Back to Edit</Button>
              <Button type="primary" onClick={handleSaveJob} loading={savingJob} style={{ background: '#16A34A', borderColor: '#16A34A' }}>
                ✓ Confirm & Save Backup Job
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── MANIFEST INSPECTION MODAL ── */}
      <Modal
        title={
          <Space>
            <EyeOutlined style={{ color: '#2563EB' }} />
            <span>Recovery Point Manifest: {selectedManifest?.snapshot_id}</span>
          </Space>
        }
        open={manifestModalOpen}
        onCancel={() => setManifestModalOpen(false)}
        footer={<Button onClick={() => setManifestModalOpen(false)}>Close</Button>}
        width={680}
      >
        {selectedManifest && (
          <div>
            <Descriptions bordered size="small" column={1} style={{ marginBottom: 14 }}>
              <Descriptions.Item label="Snapshot ID"><code>{selectedManifest.snapshot_id}</code></Descriptions.Item>
              <Descriptions.Item label="Chain ID"><Tag color="blue">{selectedManifest.chain_id}</Tag></Descriptions.Item>
              <Descriptions.Item label="Parent Snapshot">{selectedManifest.parent_id || 'Root Snapshot (None)'}</Descriptions.Item>
              <Descriptions.Item label="Storage Path"><code>{selectedManifest.repo_path}</code></Descriptions.Item>
              <Descriptions.Item label="Deduplication Efficiency"><Tag color="cyan">{selectedManifest.compression_ratio}</Tag></Descriptions.Item>
              <Descriptions.Item label="Completed Timestamp">{selectedManifest.completed_at}</Descriptions.Item>
            </Descriptions>

            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Execution Output:</div>
            <div style={{
              background: '#0F172A', color: '#F1F5F9', padding: '10px 14px',
              borderRadius: 6, maxHeight: 180, overflowY: 'auto',
              fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.5
            }}>
              {selectedManifest.logs || 'No errors logged. Manifest verification passed.'}
            </div>
          </div>
        )}
      </Modal>

      {/* ── RESTORE WIZARD MODAL ── */}
      <Modal
        title={`Restore Recovery Point (${selectedRecoveryPoint?.snapshot_id})`}
        open={restoreModalOpen}
        onCancel={() => setRestoreModalOpen(false)}
        footer={null}
        width={600}
      >
        <div>
          <Alert
            type="info"
            showIcon
            message="Point-in-Time Filesystem Restore"
            description={`Snapshot created on ${selectedRecoveryPoint?.completed_at || ''}. Data will be restored via rsync.`}
            style={{ marginBottom: 16 }}
          />
          <Form layout="vertical">
            <Form.Item label="Restore Destination Directory" required>
              <Input
                value={restoreTargetDir}
                onChange={(e) => setRestoreTargetDir(e.target.value)}
                placeholder="/backup/restored_data"
              />
            </Form.Item>
            <Form.Item>
              <Checkbox checked={restoreOverwrite} onChange={(e) => setRestoreOverwrite(e.target.checked)}>
                Allow overwriting existing files in target destination
              </Checkbox>
            </Form.Item>

            {restoreResult && (
              <Alert
                type={restoreResult.success ? 'success' : 'warning'}
                showIcon
                message={restoreResult.success ? 'Restoration Successful' : 'Conflict Warning'}
                description={restoreResult.message || restoreResult.conflict_warning}
                style={{ marginBottom: 16 }}
              />
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 20 }}>
              <Button onClick={() => setRestoreModalOpen(false)}>Close</Button>
              <Button type="primary" onClick={handleExecuteRestore} loading={restoring}>
                Start Restore
              </Button>
            </div>
          </Form>
        </div>
      </Modal>
    </div>
  )
}
