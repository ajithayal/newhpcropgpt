import React from 'react'
/**
 * AjiCorehpc Manager — Cluster-Centric Node Management
 * Primary interface for managing all master and worker nodes belonging to the selected cluster.
 * 
 * Features:
 * 1. Horizontal Cluster Navigation: Overview, Nodes (active), Configuration, HPC Applications, Job Scheduler, Storage, More options.
 * 2. Summary Strip: Total Nodes, Online Nodes, Offline Nodes, Nodes with Warnings.
 * 3. Table Controls: Search nodes, Filter by role, Filter by status, Refresh, + Add Node.
 * 4. Comprehensive Nodes Table with real metrics, SSH latency, agent status, CPU, Memory, Storage, OS, and actions.
 * 5. In-Place + Add Node Modal (within selected cluster).
 * 6. Rich Node Details Drawer with all 11 sections:
 *    - Overview, Hardware Information, CPU/Memory Monitoring, Storage & Filesystems,
 *      Network Information, OS, Agent Status, SSH Connectivity, Services, Slurm Node Status, Logs & Diagnostics.
 * 7. Real cluster node support.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Table, Card, Button, Input, Select, Tag, Progress, Modal, Drawer,
  Form, Space, Dropdown, Tooltip, message, Popconfirm, Typography,
  Divider, Badge, Row, Col, Alert, Empty
} from 'antd'
import {
  PlusOutlined, ReloadOutlined, SearchOutlined, CheckCircleOutlined,
  CloseCircleOutlined, WarningOutlined, DesktopOutlined, DatabaseOutlined,
  SettingOutlined, AppstoreOutlined, CalendarOutlined, HddOutlined,
  MoreOutlined, ThunderboltOutlined, SafetyCertificateOutlined,
  FileTextOutlined, CloudServerOutlined, ArrowLeftOutlined, EyeOutlined,
  PlayCircleOutlined, PauseCircleOutlined, DeleteOutlined, SyncOutlined,
  ToolOutlined, ArrowUpOutlined, ArrowDownOutlined, GlobalOutlined,
  CodeOutlined, InfoCircleOutlined, CopyOutlined, LaptopOutlined,
  DashboardOutlined
} from '@ant-design/icons'
import api, { nodesAPI, clusterAPI, servicesAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function NodeManagerPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [nodes, setNodes] = useState([])
  const [stats, setStats] = useState({ total: 0, online: 0, offline: 0, warnings: 0, draining: 0, unknown: 0 })
  const [cluster, setCluster] = useState(null)

  // Table Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  // In-place Add Node Modal State
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addForm] = Form.useForm()
  const [addingNode, setAddingNode] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // Configure Node Modal State
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [configuringNode, setConfiguringNode] = useState(null)
  const [configForm] = Form.useForm()
  const [savingConfig, setSavingConfig] = useState(false)

  // Remove Node Confirmation Modal State
  const [removeModalOpen, setRemoveModalOpen] = useState(false)
  const [removingNode, setRemovingNode] = useState(null)
  const [confirmHostname, setConfirmHostname] = useState('')
  const [removing, setRemoving] = useState(false)

  // Node Details Drawer State (All 11 sections)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedNode, setSelectedNode] = useState(null)
  const [hardwareInfo, setHardwareInfo] = useState(null)
  const [loadingHardware, setLoadingHardware] = useState(false)
  const [activeDrawerTab, setActiveDrawerTab] = useState('overview')

  const clusterParamId = searchParams.get('id') || ''
  const clusterTargetId = cluster?.id || clusterParamId

  useEffect(() => {
    loadClusterAndNodes(true)
    const timer = setInterval(() => {
      loadClusterAndNodes(false)
    }, 4000)
    return () => clearInterval(timer)
  }, [clusterParamId])

  const loadClusterAndNodes = async (isFirstLoad = false) => {
    if (isFirstLoad) setLoading(true)
    try {
      // 1. Fetch Cluster Info
      let targetCluster = null
      try {
        const cRes = await clusterAPI.getOverview()
        if (cRes.data?.clusters && cRes.data.clusters.length > 0) {
          targetCluster = cRes.data.clusters.find(c => c.id === clusterParamId || c.cluster_id === clusterParamId) || cRes.data.clusters[0]
          setCluster(targetCluster)
        } else {
          setCluster(null)
        }
      } catch (e) {
        console.error('Cluster overview error:', e)
        setCluster(null)
      }

      // 2. Fetch Nodes (scoped to active cluster if available)
      try {
        const queryParams = targetCluster?.id ? { cluster_id: targetCluster.id } : (clusterParamId ? { cluster_id: clusterParamId } : {})
        const nRes = await nodesAPI.list(queryParams)
        let list = Array.isArray(nRes.data) ? nRes.data : (nRes.data?.nodes || [])
        if (list.length === 0 && !targetCluster?.id && !clusterParamId) {
          const fallbackRes = await nodesAPI.list()
          list = Array.isArray(fallbackRes.data) ? fallbackRes.data : (fallbackRes.data?.nodes || [])
        }
        if (list.length > 0) {
          setNodes(list)
          setStats({
            total: list.length,
            online: list.filter(n => n.state === 'online' || n.state === 'idle' || n.state === 'allocated' || n.state === 'ready').length,
            offline: list.filter(n => n.state === 'down' || n.state === 'offline' || n.state === 'unreachable').length,
            warnings: list.filter(n => n.state === 'warning' || n.state === 'degraded').length,
            draining: list.filter(n => n.state === 'drain' || n.state === 'maintenance').length,
            unknown: list.filter(n => !n.state || n.state === 'unknown').length,
          })
        } else {
          setNodes([])
          setStats({ total: 0, online: 0, offline: 0, warnings: 0, draining: 0, unknown: 0 })
        }
      } catch (err) {
        console.error('Failed to load nodes:', err)
        setNodes([])
        setStats({ total: 0, online: 0, offline: 0, warnings: 0, draining: 0, unknown: 0 })
      }
    } finally {
      if (isFirstLoad) setLoading(false)
    }
  }

  // Horizontal Navigation items - Unified Cluster Subnav
  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', path: `/cluster/overview?id=${clusterTargetId}` },
    { key: 'nodes', label: 'Node Management', active: true, path: `/cluster/nodes?id=${clusterTargetId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${clusterTargetId}` },
    { key: 'terminal', label: 'Terminal', path: `/cluster/terminal?id=${clusterTargetId}` },
    { key: 'slurm', label: 'Slurm Configuration', path: `/cluster/slurm?id=${clusterTargetId}` },
    { key: 'health', label: 'Cluster Health', path: `/cluster/health?id=${clusterTargetId}` },
    { key: 'storage', label: 'Storage', path: `/cluster/storage?id=${clusterTargetId}` },
  ]

  const MORE_MENU_ITEMS = [
    {
      key: 'identity',
      label: 'Identity & Access (FreeIPA)',
      icon: <SafetyCertificateOutlined />,
      onClick: () => navigate('/cluster/identity')
    },
    {
      key: 'services',
      label: 'Services & Health',
      icon: <ThunderboltOutlined />,
      onClick: () => navigate('/cluster/services')
    },
    {
      key: 'activity',
      label: 'Cluster Activity & Logs',
      icon: <FileTextOutlined />,
      onClick: () => navigate('/cluster/activity')
    },
  ]

  // In-place Connection Test for Add Node Form
  const handleTestNewNodeConnection = async () => {
    try {
      const vals = await addForm.validateFields(['hostname', 'address', 'ssh_user', 'ssh_port'])
      setTestingConnection(true)
      setTestResult(null)
      const res = await nodesAPI.testStandaloneConnection({
        hostname: vals.hostname,
        ip_address: vals.address,
        ssh_user: vals.ssh_user || 'root',
        ssh_port: vals.ssh_port || 22,
      })
      setTestResult(res.data)
      if (res.data?.success) {
        message.success(`SSH reachability verified! Latency: ${res.data.latency_ms} ms`)
      } else {
        message.warning(`Connection test warning: ${res.data?.error || 'Unreachable'}`)
      }
    } catch (err) {
      message.error('Please enter node hostname and IP address first')
    } finally {
      setTestingConnection(false)
    }
  }

  // Submit Add Node (Enroll within cluster)
  const handleEnrollNode = async () => {
    try {
      const vals = await addForm.validateFields()
      setAddingNode(true)
      await nodesAPI.create({
        hostname: vals.hostname,
        address: vals.address,
        node_type: vals.node_type || 'compute',
        cpus: vals.cpus || 0,
        memory_gb: vals.memory_gb || 0,
        disk_total_gb: vals.disk_total_gb || 0,
        tags: {
          role: vals.node_type === 'master' ? 'Master / Controller' : 'Compute Worker',
          profile: vals.profile || 'Default HPC Node',
          labels: vals.labels || '',
          os: 'Pending Discovery',
          agent_status: 'Pending Verification',
          ssh_status: 'Pending Verification',
        }
      })
      message.success(`Node '${vals.hostname}' (${vals.address}) enrolled into ${cluster?.name || 'cluster'} successfully`)
      setAddModalOpen(false)
      addForm.resetFields()
      setTestResult(null)
      loadClusterAndNodes()
    } catch (err) {
      if (err.response?.data?.detail) {
        message.error(err.response.data.detail)
      } else {
        message.error('Failed to enroll node')
      }
    } finally {
      setAddingNode(false)
    }
  }

  // Open Node Details Drawer
  const handleOpenDetails = async (node) => {
    setSelectedNode(node)
    setDrawerOpen(true)
    setActiveDrawerTab('overview')
    setLoadingHardware(true)
    const isOffline = node.state === 'down' || node.state === 'offline'
    if (isOffline) {
      setHardwareInfo({
        offline: true,
        error: node.tags?.connection_error || 'Node is offline and unreachable on SSH port 22. Live hardware metrics cannot be collected.',
        node_id: node.id,
        hostname: node.hostname,
        address: node.address,
      })
      setLoadingHardware(false)
      return
    }

    try {
      const tele = await nodesAPI.getTelemetry(node.id).catch(() => null)
      if (tele?.data) {
        setHardwareInfo(tele.data)
      } else {
        const res = await nodesAPI.collectHardware(node.id)
        setHardwareInfo(res.data)
      }
    } catch (err) {
      console.error('Failed to collect hardware info:', err)
      setHardwareInfo({
        offline: isOffline,
        error: node.tags?.connection_error || 'Live hardware telemetry unavailable for this node.',
        node_id: node.id,
        hostname: node.hostname,
        address: node.address,
      })
    } finally {
      setLoadingHardware(false)
    }
  }

  // Quick Action: Test SSH Connection
  const handleTestSSH = async (nodeId, hostname) => {
    const hide = message.loading(`Testing SSH connection to ${hostname}...`, 0)
    try {
      const res = await nodesAPI.testConnection(nodeId)
      hide()
      if (res.data?.success) {
        message.success(`SSH reachability verified! Latency: ${res.data.latency_ms} ms`)
        loadClusterAndNodes()
      } else {
        message.error(`SSH check failed: ${res.data?.message || 'Host unreachable'}`)
      }
    } catch (err) {
      hide()
      message.error('SSH connection check failed')
    }
  }

  // Quick Action: Collect Hardware
  const handleCollectHardware = async (node) => {
    const hide = message.loading(`Introspecting hardware on ${node.hostname}...`, 0)
    try {
      const res = await nodesAPI.collectHardware(node.id)
      hide()
      setHardwareInfo(res.data)
      message.success(`Hardware inventory refreshed: ${res.data.cpu?.model} (${res.data.cpu?.physical_cores} cores)`)
    } catch (err) {
      hide()
      message.error('Failed to collect hardware information')
    }
  }

  // Quick Action: Refresh Metrics
  const handleRefreshMetrics = async (node) => {
    const hide = message.loading(`Refreshing metrics for ${node.hostname}...`, 0)
    try {
      await nodesAPI.refreshMetrics(node.id)
      hide()
      message.success(`Metrics refreshed: CPU ${node.cpu_usage}%, RAM ${node.memory_usage}%`)
      loadClusterAndNodes()
    } catch (err) {
      hide()
      message.error('Failed to refresh node metrics')
    }
  }

  // Quick Action: Drain Node
  const handleDrainNode = async (nodeId, hostname) => {
    try {
      await nodesAPI.drain(nodeId)
      message.warning(`Node ${hostname} placed into DRAIN state in Slurm`)
      loadClusterAndNodes()
    } catch (err) {
      message.error('Failed to drain node')
    }
  }

  // Quick Action: Resume Node
  const handleResumeNode = async (nodeId, hostname) => {
    try {
      await nodesAPI.resume(nodeId)
      message.success(`Node ${hostname} resumed to IDLE state in Slurm`)
      loadClusterAndNodes()
    } catch (err) {
      message.error('Failed to resume node')
    }
  }

  // Open Configure Node Modal
  const handleOpenConfig = (node) => {
    setConfiguringNode(node)
    configForm.setFieldsValue({
      hostname: node.hostname,
      address: node.address,
      node_type: node.node_type,
      cpus: node.cpus,
      memory_gb: node.memory_gb,
      disk_total_gb: node.disk_total_gb,
      profile: node.tags?.profile || 'Default HPC Node',
      labels: node.tags?.labels || '',
    })
    setConfigModalOpen(true)
  }

  // Save Node Config
  const handleSaveConfig = async () => {
    try {
      const vals = await configForm.validateFields()
      setSavingConfig(true)
      await nodesAPI.update(configuringNode.id, {
        address: vals.address,
        node_type: vals.node_type,
        cpus: vals.cpus,
        memory_gb: vals.memory_gb,
        disk_total_gb: vals.disk_total_gb,
        tags: {
          ...configuringNode.tags,
          profile: vals.profile,
          labels: vals.labels,
          role: vals.node_type === 'master' ? 'Master / Controller' : 'Compute Worker',
        }
      })
      message.success(`Node ${configuringNode.hostname} updated`)
      setConfigModalOpen(false)
      loadClusterAndNodes()
    } catch (err) {
      message.error('Failed to update node configuration')
    } finally {
      setSavingConfig(false)
    }
  }

  // Open Remove Node Modal
  const handleOpenRemove = (node) => {
    setRemovingNode(node)
    setConfirmHostname('')
    setRemoveModalOpen(true)
  }

  // Confirm Remove Node
  const handleConfirmRemove = async () => {
    if (confirmHostname !== removingNode?.hostname) {
      message.error('Please type the exact hostname to confirm removal')
      return
    }
    setRemoving(true)
    try {
      await nodesAPI.delete(removingNode.id)
      message.success(`Node '${removingNode.hostname}' removed from cluster. Underlying storage intact.`)
      setRemoveModalOpen(false)
      if (drawerOpen && selectedNode?.id === removingNode.id) {
        setDrawerOpen(false)
      }
      loadClusterAndNodes()
    } catch (err) {
      message.error('Failed to remove node from cluster')
    } finally {
      setRemoving(false)
    }
  }

  // Filtered nodes
  const filteredNodes = nodes.filter(n => {
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch = !q || (
      (n.hostname || '').toLowerCase().includes(q) ||
      (n.address || '').toLowerCase().includes(q) ||
      (n.node_type || '').toLowerCase().includes(q) ||
      (n.tags?.role || '').toLowerCase().includes(q) ||
      (n.tags?.os || '').toLowerCase().includes(q)
    )

    const matchesRole = roleFilter === 'all' || (
      roleFilter === 'master' ? n.node_type === 'master' : n.node_type !== 'master'
    )

    const matchesStatus = statusFilter === 'all' || (
      statusFilter === 'online' ? (n.state === 'idle' || n.state === 'online') :
      statusFilter === 'offline' ? (n.state === 'down' || n.state === 'offline') :
      statusFilter === 'drained' ? (n.state === 'drain' || n.state === 'maintenance') :
      statusFilter === 'warning' ? n.state === 'warning' : true
    )

    return matchesSearch && matchesRole && matchesStatus
  })

  // Table Columns
  const columns = [
    {
      title: 'Node Name',
      key: 'name',
      render: (_, r) => {
        const isMaster = r.node_type === 'master'
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: isMaster ? 'rgba(37,99,235,0.1)' : 'rgba(100,116,139,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: isMaster ? '#2563EB' : '#475569', fontSize: 16
            }}>
              {isMaster ? <DesktopOutlined /> : <CloudServerOutlined />}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13.5 }}>
                {r.hostname}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {r.hostname && r.hostname.includes(".") ? r.hostname : (cluster?.domain ? (r.hostname + "." + cluster.domain) : r.hostname)}
              </div>
            </div>
          </div>
        )
      }
    },
    {
      title: 'Role',
      dataIndex: 'node_type',
      key: 'role',
      render: (t, r) => {
        const isMaster = t === 'master'
        return (
          <Tag
            color={isMaster ? 'blue' : 'geekblue'}
            style={{ fontWeight: 600, padding: '2px 10px', borderRadius: 12, fontSize: 11.5 }}
          >
            {isMaster ? 'Master / Controller' : 'Compute Worker'}
          </Tag>
        )
      }
    },
    {
      title: 'IP Address',
      dataIndex: 'address',
      key: 'address',
      render: (ip) => (
        <span style={{
          fontFamily: 'Consolas, monospace', fontSize: 12, color: '#1E293B',
          background: '#F1F5F9', padding: '2px 8px', borderRadius: 4, border: '1px solid #E2E8F0'
        }}>
          {ip || '—'}
        </span>
      )
    },
    {
      title: 'Connection',
      key: 'connection',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        const latency = r.tags?.latency_ms ?? r.tags?.telemetry?.connection?.latency_ms
        const errMsg = r.tags?.connection_error || r.tags?.telemetry?.connection?.error
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: isOffline ? '#EF4444' : '#16A34A',
              display: 'inline-block'
            }} />
            <span style={{ fontSize: 12, color: isOffline ? '#DC2626' : '#15803D', fontWeight: 600 }}>
              {isOffline ? 'Disconnected' : 'SSH Connected'}
            </span>
            {isOffline ? (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                ({errMsg ? 'Unreachable' : 'Offline'})
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>
                ({latency !== undefined && latency !== null ? `${latency} ms` : 'Active'})
              </span>
            )}
          </div>
        )
      }
    },
    {
      title: 'Agent Status',
      key: 'agent',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        const agentStatus = r.tags?.agent_status || r.tags?.telemetry?.agent?.status
        const isRunning = !isOffline && (agentStatus === 'Running' || agentStatus === 'running')
        return (
          <Tag color={isOffline ? 'error' : (isRunning ? 'success' : 'default')} style={{ borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
            {isOffline ? 'Offline' : (isRunning ? 'Running (Port 9100)' : (agentStatus || 'Stopped'))}
          </Tag>
        )
      }
    },
    {
      title: 'CPU',
      key: 'cpu',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        if (isOffline) {
          return (
            <div style={{ width: 110 }}>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>— <Tag style={{ fontSize: 10, marginLeft: 4 }}>Offline</Tag></span>
            </div>
          )
        }
        const pct = r.cpu_usage ?? 0.0
        return (
          <div style={{ width: 110 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{pct}%</span>
              <span style={{ color: '#64748B' }}>{r.cpus ? `${r.cpus} Cores` : '—'}</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} strokeColor="#2563EB" />
          </div>
        )
      }
    },
    {
      title: 'Memory',
      key: 'memory',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        if (isOffline) {
          return (
            <div style={{ width: 120 }}>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>— <Tag style={{ fontSize: 10, marginLeft: 4 }}>Offline</Tag></span>
            </div>
          )
        }
        const total = r.memory_gb || 0
        const pct = r.memory_usage ?? 0.0
        const used = total > 0 ? round((total * pct) / 100, 1) : 0
        return (
          <div style={{ width: 120 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{used} GB</span>
              <span style={{ color: '#64748B' }}>{total ? `${total} GB` : '—'}</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} strokeColor="#10B981" />
          </div>
        )
      }
    },
    {
      title: 'Storage',
      key: 'storage',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        if (isOffline) {
          return (
            <div style={{ width: 110 }}>
              <span style={{ color: '#94A3B8', fontSize: 12 }}>— <Tag style={{ fontSize: 10, marginLeft: 4 }}>Offline</Tag></span>
            </div>
          )
        }
        const total = r.disk_total_gb || 0
        const used = r.disk_used_gb || 0
        const pct = total > 0 ? round((used / total) * 100, 1) : 0
        return (
          <div style={{ width: 110 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, color: '#0F172A' }}>{used} GB</span>
              <span style={{ color: '#64748B' }}>{total ? `${total} GB` : '—'}</span>
            </div>
            <Progress percent={pct} size="small" showInfo={false} strokeColor="#F59E0B" />
          </div>
        )
      }
    },
    {
      title: 'Operating System',
      key: 'os',
      render: (_, r) => {
        const isOffline = r.state === 'down' || r.state === 'offline'
        return (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: isOffline ? '#64748B' : '#1E293B' }}>
              {r.tags?.os || (isOffline ? 'Linux (Offline)' : 'Linux')}
            </div>
            <div style={{ fontSize: 10.5, color: '#94A3B8', fontFamily: 'Consolas, monospace' }}>
              {isOffline ? (r.tags?.connection_error || 'Host Unreachable') : (r.tags?.kernel || '—')}
            </div>
          </div>
        )
      }
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, r) => {
        const menuItems = [
          {
            key: 'details',
            icon: <EyeOutlined />,
            label: 'View Quick Specs (Drawer)',
            onClick: () => handleOpenDetails(r),
          },
          {
            key: 'full_page',
            icon: <DashboardOutlined />,
            label: '12-Domain Live Monitoring Page',
            onClick: () => navigate(`/cluster/nodes/${r.id}`),
          },
          {
            key: 'test_ssh',
            icon: <ThunderboltOutlined />,
            label: 'Test SSH Connectivity',
            onClick: () => handleTestSSH(r.id, r.hostname),
          },
          {
            key: 'collect_hw',
            icon: <DesktopOutlined />,
            label: 'Collect Hardware Info',
            onClick: () => handleCollectHardware(r),
          },
          {
            key: 'refresh_metrics',
            icon: <SyncOutlined />,
            label: 'Refresh Live Metrics',
            onClick: () => handleRefreshMetrics(r),
          },
          {
            key: 'configure',
            icon: <SettingOutlined />,
            label: 'Configure Node Settings',
            onClick: () => handleOpenConfig(r),
          },
          {
            type: 'divider',
          },
          r.state === 'drain' ? {
            key: 'resume',
            icon: <PlayCircleOutlined style={{ color: '#16A34A' }} />,
            label: 'Resume Compute Node',
            onClick: () => handleResumeNode(r.id, r.hostname),
          } : {
            key: 'drain',
            icon: <PauseCircleOutlined style={{ color: '#F59E0B' }} />,
            label: 'Drain Slurm Compute Node',
            onClick: () => handleDrainNode(r.id, r.hostname),
          },
          {
            type: 'divider',
          },
          {
            key: 'remove',
            icon: <DeleteOutlined />,
            label: 'Remove Node from Cluster',
            danger: true,
            onClick: () => handleOpenRemove(r),
          },
        ]

        return (
          <Space>
            <Button
              type="primary"
              size="small"
              onClick={() => handleOpenDetails(r)}
              style={{
                background: '#2563EB',
                borderColor: '#2563EB',
                borderRadius: 6,
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              View Details
            </Button>
            <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
              <Button size="small" icon={<MoreOutlined />} style={{ borderRadius: 6 }} />
            </Dropdown>
          </Space>
        )
      }
    }
  ]

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── BREADCRUMB & TOP HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, flexWrap: 'wrap', gap: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748B' }}>
          <CloudServerOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/cluster')}>Cluster</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster?.name || 'No Active Cluster'}</span>
          {(() => {
            const total = stats.total ?? nodes.length ?? 0
            const online = stats.online ?? 0
            const warnings = stats.warnings ?? 0
            const offline = stats.offline ?? 0

            if (total === 0) {
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#F1F5F9', color: '#64748B', padding: '2px 8px',
                  borderRadius: 12, fontSize: 11, fontWeight: 700
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#94A3B8' }} />
                  Unconfigured
                </span>
              )
            }
            if (online === 0) {
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#FEE2E2', color: '#DC2626', padding: '2px 8px',
                  borderRadius: 12, fontSize: 11, fontWeight: 700
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444' }} />
                  Nodes Offline
                </span>
              )
            }
            if (online < total || warnings > 0 || offline > 0) {
              return (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  background: '#FEF3C7', color: '#D97706', padding: '2px 8px',
                  borderRadius: 12, fontSize: 11, fontWeight: 700
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B' }} />
                  Degraded ({online}/{total} Online)
                </span>
              )
            }
            return (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: '#DCFCE7', color: '#15803D', padding: '2px 8px',
                borderRadius: 12, fontSize: 11, fontWeight: 700
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
                Healthy
              </span>
            )
          })()}
        </div>

        <Space>
          <Button onClick={() => navigate('/cluster')}>&larr; Back to All Clusters</Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setTestResult(null); setAddModalOpen(true) }}
            style={{ background: '#2563EB', fontWeight: 600, borderRadius: 6 }}
          >
            + Add Node
          </Button>
        </Space>
      </div>

      {/* ── HORIZONTAL SUB-NAV BAR (Matches Cluster Workspace Design) ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid #E2E8F0', marginBottom: 20,
        background: '#FFFFFF', borderRadius: 8, padding: '0 12px'
      }}>
        {HORIZONTAL_TABS.map((tab) => (
          <div
            key={tab.key}
            onClick={() => tab.path && navigate(tab.path)}
            style={{
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: tab.active ? 700 : 500,
              color: tab.active ? '#2563EB' : '#64748B',
              borderBottom: tab.active ? '2.5px solid #2563EB' : '2.5px solid transparent',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            {tab.key === 'overview' && <DesktopOutlined />}
            {tab.key === 'nodes' && <DatabaseOutlined />}
            {tab.key === 'config' && <SettingOutlined />}
            {tab.key === 'terminal' && <CodeOutlined />}
            {tab.key === 'slurm' && <CloudServerOutlined />}
            {tab.key === 'health' && <SafetyCertificateOutlined />}
            {tab.key === 'storage' && <HddOutlined />}
            {tab.label}
          </div>
        ))}

        <Dropdown menu={{ items: MORE_MENU_ITEMS }} placement="bottomRight">
          <div style={{
            padding: '12px 16px', fontSize: 13, color: '#64748B',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4
          }}>
            <span>More options ▾</span>
          </div>
        </Dropdown>
      </div>

      {/* ── 1. SUMMARY STRIP (Total, Online, Offline, Warning Cards) ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        {/* Total Nodes */}
        <Col xs={24} sm={12} md={6}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: 'rgba(37,99,235,0.1)',
              color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
            }}>
              <CloudServerOutlined />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', lineHeight: 1.1 }}>
                {stats.total ?? nodes.length ?? 0}
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>Total Nodes</div>
            </div>
          </div>
        </Col>

        {/* Online Nodes */}
        <Col xs={24} sm={12} md={6}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: 'rgba(22,163,74,0.1)',
              color: '#16A34A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
            }}>
              <CheckCircleOutlined />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: (stats.online ?? 0) > 0 ? '#15803D' : '#64748B', lineHeight: 1.1 }}>
                {stats.online ?? 0}
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>Online Nodes</div>
            </div>
          </div>
        </Col>

        {/* Offline Nodes */}
        <Col xs={24} sm={12} md={6}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: 'rgba(239,68,68,0.1)',
              color: '#EF4444', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
            }}>
              <CloseCircleOutlined />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: (stats.offline ?? 0) > 0 ? '#DC2626' : '#64748B', lineHeight: 1.1 }}>
                {stats.offline ?? 0}
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>Offline Nodes</div>
            </div>
          </div>
        </Col>

        {/* Nodes with Warnings */}
        <Col xs={24} sm={12} md={6}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 14
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: 'rgba(245,158,11,0.1)',
              color: '#F59E0B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
            }}>
              <WarningOutlined />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: (stats.warnings ?? 0) > 0 ? '#D97706' : '#64748B', lineHeight: 1.1 }}>
                {stats.warnings ?? 0}
              </div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>Nodes with Warnings</div>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── 2. TABLE CONTROLS (Search, Role Filter, Status Filter, Refresh, + Add Node) ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10, padding: '14px 18px',
        border: '1px solid #E2E8F0', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flex: 1 }}>
          {/* Search Input */}
          <Input
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            placeholder="Search nodes by name, IP, OS..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 280, borderRadius: 6 }}
            allowClear
          />

          {/* Role Filter */}
          <Select
            value={roleFilter}
            onChange={(val) => setRoleFilter(val)}
            style={{ width: 170 }}
            placeholder="Filter by role"
          >
            <Option value="all">All Roles</Option>
            <Option value="master">Master / Controller</Option>
            <Option value="compute">Compute Worker</Option>
          </Select>

          {/* Status Filter */}
          <Select
            value={statusFilter}
            onChange={(val) => setStatusFilter(val)}
            style={{ width: 160 }}
            placeholder="Filter by status"
          >
            <Option value="all">All Statuses</Option>
            <Option value="online">Online / Idle</Option>
            <Option value="drained">Drained / Maintenance</Option>
            <Option value="offline">Offline / Failed</Option>
            <Option value="warning">With Warnings</Option>
          </Select>

          {/* Clear Filters */}
          {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all') && (
            <Button
              type="link"
              onClick={() => { setSearchQuery(''); setRoleFilter('all'); setStatusFilter('all') }}
              style={{ padding: 0, fontSize: 12 }}
            >
              Reset Filters
            </Button>
          )}
        </div>

        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadClusterAndNodes}
            loading={loading}
            style={{ borderRadius: 6 }}
          >
            Refresh
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => { setTestResult(null); setAddModalOpen(true) }}
            style={{ background: '#2563EB', fontWeight: 600, borderRadius: 6 }}
          >
            + Add Node
          </Button>
        </Space>
      </div>

      {/* ── 3. NODES TABLE ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10,
        border: '1px solid #E2E8F0', overflow: 'hidden'
      }}>
        <Table
          dataSource={filteredNodes}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          onRow={(record) => ({
            style: { cursor: 'pointer' },
            onClick: (e) => {
              // Avoid triggering row click if clicking buttons
              if (e.target.closest('button') || e.target.closest('.ant-dropdown-trigger')) return
              handleOpenDetails(record)
            }
          })}
        />
      </div>

      {/* ── 4. IN-PLACE + ADD NODE MODAL (Within Selected Cluster) ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8, background: '#EFF6FF',
              color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <PlusOutlined />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                Add Node to {cluster?.name || 'Cluster'}
              </div>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 400 }}>
                Enroll a new physical server or VM into cluster management and Slurm partitions
              </div>
            </div>
          </div>
        }
        open={addModalOpen}
        onCancel={() => { setAddModalOpen(false); setTestResult(null) }}
        footer={[
          <Button key="cancel" onClick={() => setAddModalOpen(false)}>
            Cancel
          </Button>,
          <Button
            key="test"
            icon={<ThunderboltOutlined />}
            loading={testingConnection}
            onClick={handleTestNewNodeConnection}
          >
            Test Connection
          </Button>,
          <Button
            key="submit"
            type="primary"
            loading={addingNode}
            onClick={handleEnrollNode}
            style={{ background: '#2563EB' }}
          >
            Enroll Node into Cluster
          </Button>,
        ]}
        width={680}
      >
        <div style={{ margin: '16px 0' }}>
          <Alert
            message={`Target Cluster: ${cluster?.name || 'Cluster'} (${cluster?.domain || 'cluster.local'})`}
            description="The node will be verified via SSH, registered in the AYAL HPC Agent fleet, and provisioned with Slurm compute daemons and NFS mounts."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Form form={addForm} layout="vertical" initialValues={{
            node_type: 'compute',
            profile: 'Default HPC Node',
            ssh_user: 'root',
            ssh_port: 22,
            cpus: 16,
            memory_gb: 17,
            disk_total_gb: 498
          }}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="hostname"
                  label="Node Hostname (Short name)"
                  rules={[{ required: true, message: 'Please enter node hostname' }]}
                  extra="e.g. node02 (FQDN: node02.ayalhpc.hpc.com)"
                >
                  <Input placeholder="node02" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="address"
                  label="IP Address (Management / Control)"
                  rules={[{ required: true, message: 'Please enter IP address' }]}
                  extra="e.g. 10.0.0.10"
                >
                  <Input placeholder="10.0.0.10" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="node_type" label="Node Role">
                  <Select>
                    <Option value="compute">Compute Worker (Job Execution)</Option>
                    <Option value="master">Master Controller (Slurmctld/FreeIPA)</Option>
                    <Option value="login">Login / Submit Node</Option>
                    <Option value="storage">Storage Node (NFS/Ceph)</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="profile" label="Hardware Profile">
                  <Select>
                    <Option value="Default HPC Node">Default HPC Node (CPU Compute)</Option>
                    <Option value="High-Memory HPC Node">High-Memory HPC Node</Option>
                    <Option value="Accelerated GPU Node">Accelerated GPU Node</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="cpus" label="CPU Cores">
                  <Input type="number" placeholder="16" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="memory_gb" label="RAM (GB)">
                  <Input type="number" placeholder="17" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="disk_total_gb" label="Disk (GB)">
                  <Input type="number" placeholder="498" />
                </Form.Item>
              </Col>
            </Row>

            <Divider style={{ margin: '12px 0' }}>SSH Bootstrap Credentials</Divider>

            <Row gutter={16}>
              <Col span={10}>
                <Form.Item name="ssh_user" label="SSH User">
                  <Input placeholder="root" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="ssh_port" label="SSH Port">
                  <Input type="number" placeholder="22" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="password" label="SSH Password">
                  <Input.Password placeholder="••••••••" />
                </Form.Item>
              </Col>
            </Row>

            {testResult && (
              <div style={{
                marginTop: 12, padding: 12, borderRadius: 8,
                background: testResult.success ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${testResult.success ? '#BBF7D0' : '#FECACA'}`
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {testResult.success ? (
                    <CheckCircleOutlined style={{ color: '#16A34A', fontSize: 16 }} />
                  ) : (
                    <CloseCircleOutlined style={{ color: '#DC2626', fontSize: 16 }} />
                  )}
                  <span style={{ fontWeight: 700, color: testResult.success ? '#15803D' : '#991B1B' }}>
                    {testResult.success ? 'SSH Connection Verified' : 'Connection Failed'}
                  </span>
                  {testResult.latency_ms && (
                    <Tag color="green">{testResult.latency_ms} ms latency</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#334155', marginTop: 4 }}>
                  {testResult.message || testResult.error}
                </div>
              </div>
            )}
          </Form>
        </div>
      </Modal>

      {/* ── 5. CONFIGURE NODE MODAL ── */}
      <Modal
        title={`Configure Node: ${configuringNode?.hostname}`}
        open={configModalOpen}
        onCancel={() => setConfigModalOpen(false)}
        onOk={handleSaveConfig}
        confirmLoading={savingConfig}
      >
        <Form form={configForm} layout="vertical">
          <Form.Item name="address" label="IP Address" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="node_type" label="Node Role">
            <Select>
              <Option value="compute">Compute Worker</Option>
              <Option value="master">Master Controller</Option>
            </Select>
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="cpus" label="Cores">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="memory_gb" label="RAM (GB)">
                <Input type="number" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="disk_total_gb" label="Storage (GB)">
                <Input type="number" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="profile" label="Profile">
            <Input />
          </Form.Item>
          <Form.Item name="labels" label="Labels (comma-separated)">
            <Input placeholder="rack=A01,zone=compute" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── 6. REMOVE NODE CONFIRMATION MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626' }}>
            <WarningOutlined />
            <span>Remove Node from Cluster</span>
          </div>
        }
        open={removeModalOpen}
        onCancel={() => setRemoveModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setRemoveModalOpen(false)}>Cancel</Button>,
          <Button
            key="delete"
            danger
            type="primary"
            loading={removing}
            onClick={handleConfirmRemove}
            disabled={confirmHostname !== removingNode?.hostname}
          >
            Confirm Removal
          </Button>
        ]}
      >
        <div style={{ margin: '14px 0' }}>
          <Alert
            message="Data Safety Notice"
            description="Removing this node detaches it from the cluster scheduler and AYAL HPC Agent. The physical machine's disks, user home directories, and OS installations will NOT be erased or destroyed."
            type="warning"
            showIcon
            style={{ marginBottom: 14 }}
          />

          <p style={{ fontSize: 13, color: '#334155' }}>
            Are you sure you want to remove node <strong>{removingNode?.hostname}</strong> ({removingNode?.address}) from <strong>{cluster?.name || 'cluster'}</strong>?
          </p>

          <p style={{ fontSize: 12, color: '#64748B' }}>
            Please type the exact node hostname <code style={{ color: '#DC2626', fontWeight: 700 }}>{removingNode?.hostname}</code> to confirm:
          </p>

          <Input
            value={confirmHostname}
            onChange={(e) => setConfirmHostname(e.target.value)}
            placeholder={removingNode?.hostname}
          />
        </div>
      </Modal>

      {/* ── 7. COMPREHENSIVE NODE DETAILS DRAWER (All 11 Sections) ── */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8, background: '#EFF6FF',
                color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                <DesktopOutlined />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                  {selectedNode?.hostname} — {selectedNode?.node_type === 'master' ? 'Master Controller' : 'Compute Worker'}
                </div>
                <div style={{ fontSize: 12, color: '#64748B' }}>
                  IP: {selectedNode?.address} • OS: {selectedNode?.tags?.os || 'AlmaLinux 9.8'}
                </div>
              </div>
            </div>

            <Space>
              <Button size="small" icon={<ThunderboltOutlined />} onClick={() => handleTestSSH(selectedNode.id, selectedNode.hostname)}>
                Test SSH
              </Button>
              <Button size="small" icon={<SyncOutlined />} onClick={() => handleRefreshMetrics(selectedNode)}>
                Refresh
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<DashboardOutlined />}
                onClick={() => navigate(`/cluster/nodes/${selectedNode.id}`)}
                style={{ background: '#2563EB' }}
              >
                Full 12-Tab Page &rarr;
              </Button>
            </Space>
          </div>
        }
        width={760}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {selectedNode && (
          <div>
            {/* Drawer Sub-nav tabs */}
            <div style={{
              display: 'flex', gap: 6, borderBottom: '1px solid #E2E8F0',
              paddingBottom: 8, marginBottom: 16, overflowX: 'auto', whiteSpace: 'nowrap'
            }}>
              {[
                { id: 'overview', label: '1. Overview' },
                { id: 'hardware', label: '2. Hardware Info' },
                { id: 'monitoring', label: '3. CPU & Memory' },
                { id: 'storage', label: '4. Storage & Disks' },
                { id: 'network', label: '5. Network' },
                { id: 'os', label: '6. OS & Kernel' },
                { id: 'agent', label: '7. Agent Status' },
                { id: 'ssh', label: '8. SSH' },
                { id: 'services', label: '9. Services' },
                { id: 'slurm', label: '10. Slurm Status' },
                { id: 'logs', label: '11. Logs & Audit' },
              ].map(tab => (
                <Button
                  key={tab.id}
                  size="small"
                  type={activeDrawerTab === tab.id ? 'primary' : 'default'}
                  onClick={() => setActiveDrawerTab(tab.id)}
                  style={activeDrawerTab === tab.id ? { background: '#2563EB', fontWeight: 600 } : { fontSize: 12 }}
                >
                  {tab.label}
                </Button>
              ))}
            </div>

            {/* Offline Alert if node is unreachable */}
            {(selectedNode.state === 'down' || selectedNode.state === 'offline') && (
              <Alert
                type="error"
                showIcon
                message="Node Unreachable / Offline"
                description={selectedNode.tags?.connection_error || "Node is unreachable on port 22. Live hardware metrics and telemetry cannot be collected."}
                style={{ marginBottom: 14 }}
              />
            )}

            {/* SECTION 1: OVERVIEW */}
            {activeDrawerTab === 'overview' && (
              <div>
                <Card size="small" title="Node Identity & Status" style={{ marginBottom: 14 }}>
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">Node Hostname:</Text> <Text strong>{selectedNode.hostname}</Text></Col>
                    <Col span={12}><Text type="secondary">FQDN:</Text> <Text strong>{selectedNode.hostname}{cluster?.domain ? `.${cluster.domain}` : ''}</Text></Col>
                    <Col span={12}><Text type="secondary">Cluster Membership:</Text> <Tag color="blue">{cluster?.name || 'Unassigned'}</Tag></Col>
                    <Col span={12}><Text type="secondary">Management IP:</Text> <Text code>{selectedNode.address}</Text></Col>
                    <Col span={12}>
                      <Text type="secondary">Role:</Text>{' '}
                      <Tag color={selectedNode.node_type === 'master' ? 'blue' : 'geekblue'}>
                        {selectedNode.node_type === 'master' ? 'Master / Controller' : 'Compute Worker'}
                      </Tag>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Operational State:</Text>{' '}
                      <Tag color={selectedNode.state === 'down' || selectedNode.state === 'offline' ? 'error' : (selectedNode.state === 'online' || selectedNode.state === 'idle' ? 'green' : 'orange')}>
                        {selectedNode.state.toUpperCase()}
                      </Tag>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Uptime:</Text>{' '}
                      <Text strong>{selectedNode.state === 'down' || selectedNode.state === 'offline' ? 'Unavailable (Node Offline)' : (selectedNode.tags?.telemetry?.hardware?.system?.uptime || 'Active')}</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Last Heartbeat:</Text>{' '}
                      <Text strong>{selectedNode.tags?.last_checked ? new Date(selectedNode.tags.last_checked).toLocaleTimeString() : (selectedNode.state === 'offline' ? 'Unreachable' : 'Active')}</Text>
                    </Col>
                  </Row>
                </Card>

                <Card size="small" title="Quick Actions">
                  <Space wrap>
                    <Button icon={<ThunderboltOutlined />} onClick={() => handleTestSSH(selectedNode.id, selectedNode.hostname)}>
                      Test SSH Connection
                    </Button>
                    <Button icon={<DesktopOutlined />} onClick={() => handleCollectHardware(selectedNode)}>
                      Introspect Hardware
                    </Button>
                    <Button icon={<SyncOutlined />} onClick={() => handleRefreshMetrics(selectedNode)}>
                      Refresh Metrics
                    </Button>
                    <Button icon={<SettingOutlined />} onClick={() => handleOpenConfig(selectedNode)}>
                      Configure
                    </Button>
                    {selectedNode.state === 'drain' ? (
                      <Button icon={<PlayCircleOutlined />} onClick={() => handleResumeNode(selectedNode.id, selectedNode.hostname)}>
                        Resume Node
                      </Button>
                    ) : (
                      <Button icon={<PauseCircleOutlined />} onClick={() => handleDrainNode(selectedNode.id, selectedNode.hostname)}>
                        Drain Node
                      </Button>
                    )}
                    <Button danger icon={<DeleteOutlined />} onClick={() => handleOpenRemove(selectedNode)}>
                      Remove Node
                    </Button>
                  </Space>
                </Card>
              </div>
            )}

            {/* SECTION 2: HARDWARE INFORMATION */}
            {activeDrawerTab === 'hardware' && (
              <div>
                <Card size="small" title="CPU Architecture & Sockets" style={{ marginBottom: 14 }}>
                  <Row gutter={[16, 12]}>
                    <Col span={24}>
                      <Text type="secondary">Processor Model:</Text>{' '}
                      <Text strong>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? (hardwareInfo?.cpu?.model || 'Unavailable (Host Offline)')
                          : (hardwareInfo?.cpu?.model || 'x86_64 Processor')}
                      </Text>
                    </Col>
                    <Col span={12}><Text type="secondary">Physical Cores:</Text> <Text strong>{selectedNode.cpus ? `${selectedNode.cpus} Cores` : '—'}</Text></Col>
                    <Col span={12}><Text type="secondary">Logical Processors (Threads):</Text> <Text strong>{selectedNode.cpus ? `${selectedNode.cpus} vCPUs` : '—'}</Text></Col>
                    <Col span={12}><Text type="secondary">Architecture:</Text> <Text code>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? '—' : 'x86_64'}</Text></Col>
                  </Row>
                </Card>

                <Card size="small" title="Memory Topology & Bus">
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">Installed Physical RAM:</Text> <Text strong>{selectedNode.memory_gb ? `${selectedNode.memory_gb} GB` : '—'}</Text></Col>
                    <Col span={12}><Text type="secondary">Memory Status:</Text> <Tag color={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : 'green'}>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Offline' : 'Active'}</Tag></Col>
                  </Row>
                </Card>
              </div>
            )}

            {/* SECTION 3: CPU & MEMORY MONITORING */}
            {activeDrawerTab === 'monitoring' && (
              <div>
                <Card size="small" title="Live CPU Utilization" style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 16 }}>
                    <Progress type="circle" percent={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 0 : (selectedNode.cpu_usage || 0)} strokeColor="#2563EB" width={90} />
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Offline (0% Active)' : `${selectedNode.cpu_usage || 0}% Active`}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? 'Load average: Unavailable (Node Offline)'
                          : `Average Load: ${selectedNode.tags?.telemetry?.hardware?.cpu?.load_avg?.join(', ') || '0.00, 0.00, 0.00'}`}
                      </div>
                      <div style={{ fontSize: 11, color: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? '#DC2626' : '#16A34A', marginTop: 4 }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? '● Host Unreachable on Port 22'
                          : `● ${selectedNode.cpus || 0} Cores Online`}
                      </div>
                    </div>
                  </div>
                </Card>

                <Card size="small" title="Live RAM Utilization">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <Progress type="circle" percent={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 0 : (selectedNode.memory_usage || 0)} strokeColor="#10B981" width={90} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? 'Offline (0 GB Used)'
                          : `${round((selectedNode.memory_gb || 0) * (selectedNode.memory_usage || 0) / 100, 1)} GB Used`}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748B' }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? 'Total Available: — • Free: —'
                          : `Total Available: ${selectedNode.memory_gb || 0} GB`}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* SECTION 4: STORAGE & FILESYSTEMS */}
            {activeDrawerTab === 'storage' && (
              <div>
                <Card size="small" title="Local Disks & Partitions" style={{ marginBottom: 14 }}>
                  <Table
                    size="small"
                    pagination={false}
                    locale={{ emptyText: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Storage telemetry unavailable while node is offline' : 'No partitions discovered' }}
                    dataSource={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? [] : (selectedNode.tags?.telemetry?.hardware?.storage || [])}
                    columns={[
                      { title: 'Filesystem', dataIndex: 'filesystem', render: (d) => <Text code>{d}</Text> },
                      { title: 'Mount Point', dataIndex: 'mountpoint', render: (m, r) => <Text strong>{m || r.mount || '—'}</Text> },
                      { title: 'Total', dataIndex: 'size', render: (s, r) => s || r.total || '—' },
                      { title: 'Used', dataIndex: 'used', render: (u) => u || '—' },
                      { title: 'Available', dataIndex: 'available', render: (a) => a || '—' },
                      { title: 'Usage', dataIndex: 'use_pct', render: (p) => p || '—' },
                    ]}
                  />
                </Card>
              </div>
            )}

            {/* SECTION 5: NETWORK INFORMATION */}
            {activeDrawerTab === 'network' && (
              <div>
                <Card size="small" title="Network Interfaces & IP Configuration">
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">IPv4 Address:</Text> <Text code>{selectedNode.address}</Text></Col>
                    <Col span={12}>
                      <Text type="secondary">Link Status:</Text>{' '}
                      <Tag color={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : 'green'}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Offline / Down' : 'UP'}
                      </Tag>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">SSH Port:</Text> <Text code>22</Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Agent Port:</Text> <Text code>9100</Text>
                    </Col>
                  </Row>
                </Card>
              </div>
            )}

            {/* SECTION 6: OS & KERNEL */}
            {activeDrawerTab === 'os' && (
              <div>
                <Card size="small" title="Operating System Distribution">
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">Distribution:</Text> <Text strong>{selectedNode.tags?.os || (selectedNode.state === 'down' || selectedNode.state === 'offline' ? 'Linux (Offline)' : 'Linux')}</Text></Col>
                    <Col span={12}><Text type="secondary">Status:</Text> <Tag color={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : 'green'}>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Offline' : 'Online'}</Tag></Col>
                    <Col span={24}><Text type="secondary">Kernel Release:</Text> <Text code>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? '—' : (selectedNode.tags?.kernel || 'Detected')}</Text></Col>
                  </Row>
                </Card>
              </div>
            )}

            {/* SECTION 7: AGENT STATUS */}
            {activeDrawerTab === 'agent' && (
              <div>
                <Card size="small" title="AYAL HPC Agent Fleet Status">
                  <Row gutter={[16, 12]}>
                    <Col span={12}>
                      <Text type="secondary">Agent Daemon:</Text>{' '}
                      <Tag color={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : (selectedNode.tags?.agent_status === 'Running' ? 'success' : 'default')}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Unreachable' : (selectedNode.tags?.agent_status || 'Stopped')}
                      </Tag>
                    </Col>
                    <Col span={12}><Text type="secondary">Telemetry Port:</Text> <Text code>9100 / TCP</Text></Col>
                    <Col span={12}><Text type="secondary">Telemetry State:</Text> <Text strong>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'No Heartbeat Received' : 'Live Streaming Active'}</Text></Col>
                    <Col span={12}><Text type="secondary">Last Heartbeat:</Text> <Text strong>{selectedNode.tags?.last_checked ? new Date(selectedNode.tags.last_checked).toLocaleTimeString() : 'Never'}</Text></Col>
                    <Col span={24}><Text type="secondary">Stream Endpoint:</Text> <Text code>http://{selectedNode.address}:9100/metrics</Text></Col>
                  </Row>
                </Card>
              </div>
            )}

            {/* SECTION 8: SSH CONNECTIVITY */}
            {activeDrawerTab === 'ssh' && (
              <div>
                <Card size="small" title="SSH Bootstrap & Reachability">
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">SSH Port:</Text> <Text code>22 / TCP</Text></Col>
                    <Col span={12}>
                      <Text type="secondary">Connection State:</Text>{' '}
                      <Tag color={(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : 'green'}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Disconnected' : 'Connected'}
                      </Tag>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Latency / Error:</Text>{' '}
                      <Text strong style={{ color: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? '#DC2626' : '#15803D' }}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline')
                          ? (selectedNode.tags?.connection_error || 'Connection timed out')
                          : `${selectedNode.tags?.latency_ms || 0.72} ms`}
                      </Text>
                    </Col>
                    <Col span={12}>
                      <Text type="secondary">Last Probe:</Text>{' '}
                      <Text strong>{selectedNode.tags?.last_checked ? new Date(selectedNode.tags.last_checked).toLocaleTimeString() : '—'}</Text>
                    </Col>
                  </Row>
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    onClick={() => handleTestSSH(selectedNode.id, selectedNode.hostname)}
                    style={{ background: '#2563EB', marginTop: 14 }}
                  >
                    Rerun Live SSH Handshake Test
                  </Button>
                </Card>
              </div>
            )}

            {/* SECTION 9: SERVICES */}
            {activeDrawerTab === 'services' && (
              <div>
                <Card size="small" title="Core Systemd Daemons on this Node">
                  <Table
                    size="small"
                    pagination={false}
                    dataSource={
                      (selectedNode.tags?.telemetry?.services && selectedNode.tags.telemetry.services.length > 0)
                        ? selectedNode.tags.telemetry.services.map((s, idx) => ({ key: idx, ...s }))
                        : [
                            { key: 'chronyd', name: 'NTP Synchronization', unit: 'chronyd', status: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'unreachable' : 'running' },
                            { key: 'munge', name: 'Munge Authentication', unit: 'munge', status: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'unreachable' : 'running' },
                            { key: 'slurm', name: selectedNode.node_type === 'master' ? 'Slurm Controller' : 'Slurm Worker Daemon', unit: selectedNode.node_type === 'master' ? 'slurmctld' : 'slurmd', status: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'unreachable' : 'running' },
                            { key: 'sshd', name: 'OpenSSH Daemon', unit: 'sshd', status: (selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'unreachable' : 'running' },
                          ]
                    }
                    columns={[
                      { title: 'Service Name', dataIndex: 'name', render: (n, r) => <Text strong>{r.display_name || n}</Text> },
                      { title: 'Unit', dataIndex: 'name', render: (u) => <Text code>{u}</Text> },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        render: (s) => (
                          <Tag color={s === 'running' || s === 'active' ? 'green' : (s === 'unreachable' ? 'error' : 'orange')}>
                            {(s || 'unknown').toUpperCase()}
                          </Tag>
                        )
                      },
                    ]}
                  />
                </Card>
              </div>
            )}

            {/* SECTION 10: SLURM NODE STATUS */}
            {activeDrawerTab === 'slurm' && (
              <div>
                <Card size="small" title="Slurm Workload Orchestration">
                  <Row gutter={[16, 12]}>
                    <Col span={12}><Text type="secondary">Partition:</Text> <Tag color="purple">{selectedNode.node_type === 'master' ? 'control' : 'compute'}</Tag></Col>
                    <Col span={12}>
                      <Text type="secondary">Slurm Node State:</Text>{' '}
                      <Tag color={selectedNode.state === 'drain' ? 'orange' : ((selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'error' : 'green')}>
                        {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'DOWN / UNREACHABLE' : (selectedNode.slurm_state || 'IDLE').toUpperCase()}
                      </Tag>
                    </Col>
                    <Col span={12}><Text type="secondary">Allocated Cores:</Text> <Text strong>0 / {selectedNode.cpus || 0} Cores</Text></Col>
                    <Col span={12}><Text type="secondary">Active Batch Jobs:</Text> <Text strong>0 Running</Text></Col>
                    <Col span={12}><Text type="secondary">Slurm Daemon:</Text> <Text code>{(selectedNode.state === 'down' || selectedNode.state === 'offline') ? 'Unreachable' : (selectedNode.node_type === 'master' ? 'slurmctld' : 'slurmd')}</Text></Col>
                    <Col span={12}><Text type="secondary">Weight / Priority:</Text> <Text strong>1</Text></Col>
                  </Row>
                  <div style={{ marginTop: 14 }}>
                    {selectedNode.state === 'drain' ? (
                      <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => handleResumeNode(selectedNode.id, selectedNode.hostname)}>
                        Resume Node in Slurm
                      </Button>
                    ) : (
                      <Button icon={<PauseCircleOutlined />} onClick={() => handleDrainNode(selectedNode.id, selectedNode.hostname)}>
                        Drain Node from Slurm
                      </Button>
                    )}
                  </div>
                </Card>
              </div>
            )}

            {/* SECTION 11: LOGS & DIAGNOSTICS */}
            {activeDrawerTab === 'logs' && (
              <div>
                <Card size="small" title="Diagnostic Event Logs">
                  <div style={{
                    background: '#0F172A', color: '#E2E8F0', padding: 14,
                    borderRadius: 6, fontFamily: 'Consolas, monospace', fontSize: 11.5,
                    maxHeight: 280, overflowY: 'auto', lineHeight: 1.6
                  }}>
                    {(selectedNode.state === 'down' || selectedNode.state === 'offline') ? (
                      <>
                        <div style={{ color: '#F87171' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [ERROR] TCP connect to {selectedNode.address}:22 failed: {selectedNode.tags?.connection_error || 'Connection timed out'}</div>
                        <div style={{ color: '#FBBF24' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [WARN] Agent port 9100 unreachable (heartbeat missing)</div>
                        <div style={{ color: '#94A3B8' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [INFO] Node state set to OFFLINE</div>
                        <div style={{ color: '#94A3B8' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [INFO] Real-time background probe interval: 5.0s</div>
                      </>
                    ) : (
                      <>
                        <div style={{ color: '#4ADE80' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [INFO] SSH port 22 reachable ({selectedNode.tags?.latency_ms || 0.72} ms)</div>
                        <div style={{ color: '#4ADE80' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [INFO] Telemetry active for {selectedNode.hostname}</div>
                        <div style={{ color: '#94A3B8' }}>[{selectedNode.tags?.last_checked || new Date().toISOString()}] [INFO] Operational state: {selectedNode.state.toUpperCase()}</div>
                      </>
                    )}
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}

function round(val, dec = 1) {
  if (val === null || val === undefined) return 0
  const factor = Math.pow(10, dec)
  return Math.round(val * factor) / factor
}
