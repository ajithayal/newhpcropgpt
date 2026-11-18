import React from 'react'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal, Switch, Button, Tag, Space, Typography, Tooltip } from 'antd'
import {
  SettingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  CheckOutlined,
  DesktopOutlined,
  CloudServerOutlined,
  CodeOutlined,
} from '@ant-design/icons'
import Gauge from '../components/ui/Gauge'
import DonutChart from '../components/ui/DonutChart'
import InfoCard from '../components/ui/InfoCard'
import { KVRow, AlertLine } from '../components/ui/Shared'
import api from '../services/api'

const { Text } = Typography

const DEFAULT_WIDGET_CONFIG = [
  { id: 'cluster_info', title: 'Cluster Information', visible: true, fullWidth: false },
  { id: 'license_profile', title: 'Customer & License Profile', visible: true, fullWidth: false },
  { id: 'system_resources', title: 'System Resources', visible: true, fullWidth: false },
  { id: 'cluster_operation', title: 'Cluster Operation', visible: true, fullWidth: false },
  { id: 'node_connectivity', title: 'Node Connectivity', visible: true, fullWidth: false },
  { id: 'node_config', title: 'Node Config Status', visible: true, fullWidth: false },
  { id: 'partition_status', title: 'Partition Status', visible: true, fullWidth: false },
  { id: 'gpu_status', title: 'GPU Status', visible: true, fullWidth: false },
  { id: 'agent_status', title: 'Agent Status', visible: true, fullWidth: false },
  { id: 'license_seats', title: 'License Seat Status', visible: true, fullWidth: false },
  { id: 'event_console', title: 'Cluster Event Console', visible: true, fullWidth: true },
]

export default function DashboardPage() {
  const [stats, setStats] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [custProfile, setCustProfile] = useState(null)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [eventFilter, setEventFilter] = useState('all') // 'all' | 'error' | 'warning' | 'info'
  const navigate = useNavigate()

  // Layout preference state with localStorage persistence
  const [widgets, setWidgets] = useState(() => {
    try {
      const saved = localStorage.getItem('ajicorehpc_dashboard_layout_v2')
      if (saved) {
        const parsed = JSON.parse(saved)
        // Ensure no old hardware_vendor widget exists in saved state
        const filtered = parsed.filter(w => w.id !== 'hardware_vendor')
        // Ensure all default widgets exist
        const ids = new Set(filtered.map(w => w.id))
        DEFAULT_WIDGET_CONFIG.forEach(d => {
          if (!ids.has(d.id)) filtered.push(d)
        })
        return filtered
      }
    } catch (e) {
      console.warn('Failed to parse saved layout preference', e)
    }
    return DEFAULT_WIDGET_CONFIG
  })

  useEffect(() => {
    try {
      localStorage.setItem('ajicorehpc_dashboard_layout_v2', JSON.stringify(widgets))
    } catch (e) {
      console.error(e)
    }
  }, [widgets])

  useEffect(() => {
    loadDashboard()
    loadProfile()
    const interval = setInterval(loadDashboard, 2500)
    return () => clearInterval(interval)
  }, [])

  const loadProfile = async () => {
    try {
      const res = await api.get('/customer/profile')
      setCustProfile(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  const loadDashboard = async () => {
    try {
      const [statsRes, alertsRes, monRes] = await Promise.allSettled([
        api.get('/dashboard/stats'),
        api.get('/alerts', { params: { limit: 20 } }),
        api.get('/monitoring/overview'),
      ])

      let baseStats = statsRes.status === 'fulfilled' ? (statsRes.value.data || {}) : {}

      if (monRes.status === 'fulfilled' && monRes.value.data) {
        const mon = monRes.value.data
        const summary = mon.summary || {}
        baseStats = {
          ...baseStats,
          cpu_avg: summary.avg_cpu_pct !== undefined ? summary.avg_cpu_pct : (baseStats.cpu_avg ?? 0.0),
          memory_pct: summary.avg_memory_pct !== undefined ? summary.avg_memory_pct : (baseStats.memory_pct ?? 0.0),
          storage_pct: summary.storage_utilization_pct !== undefined ? summary.storage_utilization_pct : (baseStats.storage_pct ?? 0.0),
          nodes: {
            ...(baseStats.nodes || {}),
            total: summary.total_nodes ?? baseStats.nodes?.total ?? 0,
            online: summary.online_nodes ?? baseStats.nodes?.online ?? 0,
            offline: summary.offline_nodes ?? baseStats.nodes?.offline ?? 0,
            total_gpus: summary.total_gpus ?? baseStats.nodes?.total_gpus ?? 0,
            nodes_info: mon.nodes && mon.nodes.length > 0
              ? mon.nodes.map(n => ({
                  id: n.id,
                  hostname: n.hostname,
                  role: n.role,
                  address: n.ip,
                  status: n.status,
                  cpu_usage: n.cpu_usage,
                  memory_usage: n.memory_usage,
                }))
              : (baseStats.nodes?.nodes_info || []),
          },
          jobs: {
            ...(baseStats.jobs || {}),
            running: summary.running_jobs ?? baseStats.jobs?.running ?? 0,
            pending: summary.pending_jobs ?? baseStats.jobs?.pending ?? 0,
            failed: summary.failed_jobs ?? baseStats.jobs?.failed ?? 0,
          },
        }
      }
      setStats(baseStats)

      const baseAlerts = alertsRes.status === 'fulfilled'
        ? (Array.isArray(alertsRes.value.data) ? alertsRes.value.data : (alertsRes.value.data?.items || alertsRes.value.data?.alerts || []))
        : []

      const monAlerts = (monRes.status === 'fulfilled' && monRes.value.data?.active_alerts)
        ? monRes.value.data.active_alerts.map(a => ({
            id: a.id,
            level: a.severity || 'warning',
            severity: a.severity || 'warning',
            title: a.title,
            message: a.message,
            timestamp: a.created_at,
          }))
        : []

      const alertMap = new Map()
      monAlerts.forEach(a => alertMap.set(a.id || a.title, a))
      baseAlerts.forEach(a => {
        if (!alertMap.has(a.id || a.title)) {
          alertMap.set(a.id || a.title, a)
        }
      })
      setAlerts(Array.from(alertMap.values()))
    } catch (err) {
      console.error('Failed to load dashboard telemetry', err)
    }
  }

  // Widget management handlers
  const toggleWidget = (id) => {
    setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w))
  }

  const moveWidget = (index, direction) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= widgets.length) return
    const updated = [...widgets]
    const temp = updated[index]
    updated[index] = updated[targetIndex]
    updated[targetIndex] = temp
    setWidgets(updated)
  }

  const resetLayout = () => {
    setWidgets(DEFAULT_WIDGET_CONFIG)
  }

  const s = stats || {}
  const cluster = s.cluster || {}
  const nodes = s.nodes || {}
  const jobs = s.jobs || {}
  const storage = s.storage || {}

  const onlineNodes = nodes.online ?? 0
  const totalNodes = nodes.total ?? 0
  const offlineNodes = nodes.offline ?? Math.max(0, totalNodes - onlineNodes)
  const maintenanceNodes = nodes.maintenance ?? 0
  const totalGpus = nodes.total_gpus ?? 0
  const healthyGpus = nodes.healthy_gpus ?? 0

  const alertColorMap = {
    critical: 'var(--red, #DC2626)',
    error: 'var(--red, #DC2626)',
    warning: 'var(--orange, #F59E0B)',
    info: 'var(--blue, #2563EB)',
    resolved: 'var(--green, #16A34A)',
    ok: 'var(--green, #16A34A)',
  }

  const filteredAlerts = alerts.filter(a => {
    if (eventFilter === 'all') return true
    const lvl = (a.level || a.severity || '').toLowerCase()
    if (eventFilter === 'error') return lvl === 'error' || lvl === 'critical'
    if (eventFilter === 'warning') return lvl === 'warning'
    if (eventFilter === 'info') return lvl === 'info' || lvl === 'notice'
    return true
  })

  // Render individual widget contents
  const renderWidgetContent = (id) => {
    switch (id) {
      case 'cluster_info':
        return (
          <InfoCard title="Cluster Information">
            <KVRow label="Item Name" value={cluster.name || (totalNodes > 0 ? 'HPC Cluster' : 'No Cluster Configured')} />
            <KVRow label="Serial Number" value={cluster.serial || 'Unassigned'} />
            <KVRow label="Cluster Time" value={cluster.time || new Date().toUTCString()} />
            <KVRow label="Software Stack" value={onlineNodes > 0 ? (cluster.version || 'OpenHPC 3.5 / AYAL HPC 1.0') : 'Not Deployed'} />
            <KVRow label="Session Configuration" value={onlineNodes > 0 ? (cluster.session_config || 'Active & Synced') : 'Unconfigured / Standby'} />
            <KVRow label="Current Administrator" value={cluster.admins || 'admin (Superadmin)'} />
            <KVRow label="Uptime" value={onlineNodes > 0 ? (cluster.uptime || 'Online') : 'Offline (0 Nodes Online)'} />
          </InfoCard>
        )

      case 'license_profile':
        return (
          <InfoCard title="Customer & License Profile">
            <KVRow label="Customer ID" value={(custProfile?.customer_id || 'AYAL-CUST-PROD').replace('AJICORE-CUST-', 'AYAL-CUST-')} valueColor="#2563EB" />
            <KVRow label="Organization" value={custProfile?.organization_name || 'Enterprise HPC'} />
            <KVRow label="Installation ID" value={(custProfile?.installation_id || 'AYAL-INST-DETECTED').replace('AJICORE-INST-', 'AYAL-INST-')} />
            <KVRow label="License Tier" value={custProfile?.license?.plan || 'STANDARD'} valueColor="var(--green, #16A34A)" />
            <KVRow label="Validity" value="PERPETUAL (Permanent)" valueColor="var(--green, #16A34A)" />
            <KVRow label="Compute Nodes" value={`Up to ${custProfile?.license?.max_nodes || 32} Nodes`} />
            <KVRow label="Status" value="Cryptographically Verified" valueColor="var(--green, #16A34A)" />
          </InfoCard>
        )

      case 'system_resources':
        return (
          <InfoCard title="System Resources">
            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', padding: '6px 0 2px' }}>
              <Gauge value={stats?.cpu_avg !== undefined && stats?.cpu_avg !== null ? stats.cpu_avg : 0.0} label="Average CPU Usage" color="var(--blue, #2563EB)" />
              <Gauge value={stats?.memory_pct !== undefined && stats?.memory_pct !== null ? stats.memory_pct : 0.0} label="Memory Usage" color="var(--green, #16A34A)" />
              <Gauge value={stats?.storage_pct !== undefined && stats?.storage_pct !== null ? stats.storage_pct : 0.0} label="Storage Usage" color="var(--orange, #F59E0B)" />
            </div>
            <div
              onClick={() => navigate('/cluster/overview')}
              style={{ display: 'block', textAlign: 'center', fontSize: 11, color: 'var(--accent, #2563EB)', marginTop: 8, cursor: 'pointer', fontWeight: 600 }}
            >
              More Details →
            </div>
          </InfoCard>
        )

      case 'cluster_operation':
        return (
          <InfoCard title="Cluster Operation">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <CloudServerOutlined style={{ color: '#2563EB', fontSize: 16 }} />
                <span style={{ fontWeight: 800, color: '#0F172A', fontSize: 14 }}>
                  {totalNodes > 0 ? (cluster.name || 'HPC Cluster') : 'No Cluster Configured'}
                </span>
              </div>
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: onlineNodes > 0 ? '#DCFCE7' : (totalNodes > 0 ? '#FEE2E2' : '#F1F5F9'),
                color: onlineNodes > 0 ? '#15803D' : (totalNodes > 0 ? '#B91C1C' : '#64748B'),
                padding: '2px 8px', borderRadius: 12, fontSize: 10.5, fontWeight: 700
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: onlineNodes > 0 ? '#16A34A' : (totalNodes > 0 ? '#DC2626' : '#94A3B8')
                }} />
                {onlineNodes > 0 ? `${onlineNodes} Online` : (totalNodes > 0 ? `${offlineNodes} Offline` : 'Standby')}
              </span>
            </div>

            {totalNodes > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {(stats?.nodes?.nodes_info || []).slice(0, 3).map((n, idx) => (
                  <div key={idx} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '6px 8px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0', fontSize: 11.5
                  }}>
                    <span style={{ fontWeight: 600, color: '#0F172A' }}>{n.hostname} ({n.role})</span>
                    <span style={{ color: '#64748B', fontFamily: 'monospace' }}>{n.address}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{
                padding: '12px 10px', background: '#F8FAFC', borderRadius: 6, border: '1px dashed #CBD5E1',
                textAlign: 'center', marginBottom: 12, fontSize: 11.5, color: '#64748B'
              }}>
                No compute nodes registered yet.
                <div
                  style={{ marginTop: 4, fontWeight: 700, color: '#2563EB', cursor: 'pointer' }}
                  onClick={() => navigate('/cluster/create')}
                >
                  + Set Up New Cluster
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              <Button size="small" icon={<SettingOutlined />} onClick={() => navigate('/cluster/config')} style={{ flex: 1, fontSize: 11, height: 28 }}>
                Config
              </Button>
              <Button size="small" type="primary" icon={<DesktopOutlined />} onClick={() => navigate('/cluster/overview')} style={{ flex: 1, fontSize: 11, height: 28, background: '#2563EB' }}>
                Overview
              </Button>
              <Button size="small" icon={<CodeOutlined />} onClick={() => navigate('/cluster/terminal')} style={{ flex: 1, fontSize: 11, height: 28 }}>
                Terminal
              </Button>
            </div>
          </InfoCard>
        )

      case 'node_connectivity':
        return (
          <InfoCard title="Node Connectivity">
            <DonutChart
              centerNum={totalNodes}
              centerLabel={totalNodes === 0 ? "No Nodes" : "Nodes"}
              segments={
                totalNodes > 0
                  ? [
                      { label: 'Online', value: onlineNodes, color: 'var(--green, #16A34A)' },
                      { label: 'Maintenance', value: maintenanceNodes, color: 'var(--gray, #94A3B8)' },
                      { label: 'Offline', value: offlineNodes, color: 'var(--red, #DC2626)' },
                    ]
                  : [
                      { label: 'Unconfigured', value: 0, color: 'var(--gray, #94A3B8)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'node_config':
        return (
          <InfoCard title="Node Config Status">
            <DonutChart
              centerNum={totalNodes}
              centerLabel={totalNodes === 0 ? "No Nodes" : "Nodes"}
              segments={
                totalNodes > 0
                  ? [
                      { label: 'Auto-Updated', value: nodes.auto_updated ?? (onlineNodes > 0 ? totalNodes : 0), color: 'var(--blue, #2563EB)' },
                      { label: 'Unknown / Offline', value: nodes.unknown_config ?? offlineNodes, color: 'var(--gray, #94A3B8)' },
                    ]
                  : [
                      { label: 'Unconfigured', value: 0, color: 'var(--gray, #94A3B8)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'partition_status':
        return (
          <InfoCard title="Partition Status">
            <DonutChart
              centerNum={totalNodes > 0 ? (stats?.partitions?.total ?? 1) : 0}
              centerLabel={totalNodes > 0 ? "Partition" : "No Partitions"}
              segments={
                totalNodes > 0
                  ? [
                      { label: onlineNodes > 0 ? 'compute (Active)' : 'compute (Offline)', value: stats?.partitions?.enabled ?? (onlineNodes > 0 ? 1 : 0), color: onlineNodes > 0 ? 'var(--purple, #8B5CF6)' : 'var(--gray, #94A3B8)' },
                    ]
                  : [
                      { label: 'Unconfigured', value: 0, color: 'var(--gray, #94A3B8)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'gpu_status':
        return (
          <InfoCard title="GPU Status">
            <DonutChart
              centerNum={totalGpus}
              centerLabel={totalGpus === 0 ? "No GPUs" : "GPUs"}
              segments={
                totalGpus > 0
                  ? [
                      { label: 'Healthy', value: healthyGpus, color: 'var(--green, #16A34A)' },
                      { label: 'High Temp', value: Math.max(0, totalGpus - healthyGpus), color: 'var(--orange, #F59E0B)' },
                    ]
                  : [
                      { label: 'Installed (CPU Cluster)', value: 0, color: 'var(--muted, #94A3B8)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'agent_status':
        return (
          <InfoCard title="Agent Status">
            <DonutChart
              centerNum={nodes.agents_total ?? totalNodes}
              centerLabel={totalNodes === 0 ? "No Devices" : "Devices"}
              segments={
                totalNodes > 0
                  ? [
                      { label: 'Up To Date', value: nodes.agents_updated ?? totalNodes, color: 'var(--green, #16A34A)' },
                      { label: 'Update Available', value: nodes.agents_update ?? 0, color: 'var(--orange, #F59E0B)' },
                    ]
                  : [
                      { label: 'Unconfigured', value: 0, color: 'var(--gray, #94A3B8)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'license_seats':
        return (
          <InfoCard title="License Seat Status">
            <DonutChart
              centerNum={stats?.license_seats?.total ?? totalNodes}
              centerLabel="Seats"
              segments={
                totalNodes > 0
                  ? [
                      { label: 'Valid', value: stats?.license_seats?.valid ?? totalNodes, color: 'var(--green, #16A34A)' },
                      { label: 'Expiring Soon', value: stats?.license_seats?.expiring ?? 0, color: 'var(--orange, #F59E0B)' },
                      { label: 'Expired', value: stats?.license_seats?.expired ?? 0, color: 'var(--red, #DC2626)' },
                    ]
                  : [
                      { label: 'Available Seats', value: custProfile?.license?.max_nodes || 32, color: 'var(--green, #16A34A)' },
                    ]
              }
            />
          </InfoCard>
        )

      case 'event_console':
        return (
          <div style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--card-border, #E2E8F0)',
            borderRadius: 8,
            padding: '14px 18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}>
            {/* Console Header with filters */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text, #0F172A)' }}>
                  Cluster Event Console
                </span>
                <Tag color={filteredAlerts.length > 0 ? "blue" : "default"}>
                  {filteredAlerts.length} Events
                </Tag>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted, #64748B)', marginRight: 4 }}>Filter:</span>
                {[
                  { key: 'all', label: 'All' },
                  { key: 'error', label: 'Critical / Errors' },
                  { key: 'warning', label: 'Warnings' },
                  { key: 'info', label: 'Info' },
                ].map(f => (
                  <Button
                    key={f.key}
                    size="small"
                    type={eventFilter === f.key ? 'primary' : 'default'}
                    onClick={() => setEventFilter(f.key)}
                    style={{ fontSize: 11, height: 24, padding: '0 8px' }}
                  >
                    {f.label}
                  </Button>
                ))}
                <Button size="small" icon={<ReloadOutlined />} onClick={loadDashboard} style={{ height: 24, padding: '0 8px', fontSize: 11 }}>
                  Refresh
                </Button>
              </div>
            </div>

            {/* Events Log Stream */}
            <div style={{
              maxHeight: 220,
              overflowY: 'auto',
              background: '#0F172A',
              borderRadius: 6,
              padding: '10px 14px',
              fontFamily: 'Consolas, Monaco, monospace',
              border: '1px solid #1E293B',
            }}>
              {filteredAlerts.length > 0 ? (
                filteredAlerts.map((a, i) => (
                  <div key={a.id || i} style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 10,
                    padding: '4px 0',
                    borderBottom: '1px solid #1E293B',
                    fontSize: 12,
                  }}>
                    <span style={{ color: '#64748B', fontSize: 11, flexShrink: 0 }}>
                      [{new Date(a.created_at || a.timestamp || Date.now()).toLocaleTimeString()}]
                    </span>
                    <span style={{
                      fontWeight: 700,
                      color: alertColorMap[a.level || a.severity] || '#38BDF8',
                      textTransform: 'uppercase',
                      fontSize: 10,
                      minWidth: 64,
                      flexShrink: 0,
                    }}>
                      {a.level || a.severity || 'INFO'}
                    </span>
                    <span style={{ color: '#E2E8F0', flex: 1, wordBreak: 'break-word' }}>
                      {a.message || a.title || 'Cluster event message'}
                    </span>
                  </div>
                ))
              ) : (
                <div style={{ padding: '24px 0', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                  ✓ No active cluster or security events. All components operational.
                </div>
              )}
            </div>
          </div>
        )

      default:
        return null
    }
  }

  return (
    <>
      {/* Top Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #0F172A)' }}>Dashboard</span>
        <span style={{ flex: 1 }} />
        <Button
          icon={<SettingOutlined />}
          onClick={() => setCustomizeOpen(true)}
          style={{
            background: 'var(--card, #fff)',
            border: '1px solid var(--card-border, #E2E8F0)',
            fontSize: 12,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          Customize Dashboard
        </Button>
      </div>

      {/* Dynamic Grid Layout */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
      }}>
        {widgets.filter(w => w.visible).map((w) => (
          <div
            key={w.id}
            style={w.fullWidth || w.id === 'event_console' ? { gridColumn: '1 / -1' } : {}}
          >
            {renderWidgetContent(w.id)}
          </div>
        ))}
      </div>

      {/* Customize Dashboard Modal */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SettingOutlined style={{ color: '#2563EB' }} />
            <span>Customize Dashboard Layout & Widgets</span>
          </div>
        }
        open={customizeOpen}
        onCancel={() => setCustomizeOpen(false)}
        footer={[
          <Button key="reset" icon={<ReloadOutlined />} onClick={resetLayout}>
            Reset to Default
          </Button>,
          <Button key="close" type="primary" onClick={() => setCustomizeOpen(false)}>
            Done
          </Button>,
        ]}
        width={560}
      >
        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16 }}>
          Toggle widgets on or off and arrange their display order. Changes are saved automatically in your browser session.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 440, overflowY: 'auto', paddingRight: 4 }}>
          {widgets.map((w, index) => (
            <div
              key={w.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 14px',
                borderRadius: 8,
                background: w.visible ? '#F8FAFC' : '#F1F5F9',
                border: w.visible ? '1px solid #CBD5E1' : '1px dashed #E2E8F0',
                opacity: w.visible ? 1 : 0.65,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B', width: 22 }}>
                  #{index + 1}
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                    {w.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>
                    {w.fullWidth || w.id === 'event_console' ? 'Full Width (100%)' : 'Standard Card (1/4 Width)'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Button
                  size="small"
                  icon={<ArrowUpOutlined />}
                  disabled={index === 0}
                  onClick={() => moveWidget(index, -1)}
                  title="Move Up"
                />
                <Button
                  size="small"
                  icon={<ArrowDownOutlined />}
                  disabled={index === widgets.length - 1}
                  onClick={() => moveWidget(index, 1)}
                  title="Move Down"
                />
                <Switch
                  checked={w.visible}
                  onChange={() => toggleWidget(w.id)}
                  checkedChildren={<EyeOutlined />}
                  unCheckedChildren={<EyeInvisibleOutlined />}
                  style={{ marginLeft: 6 }}
                />
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
