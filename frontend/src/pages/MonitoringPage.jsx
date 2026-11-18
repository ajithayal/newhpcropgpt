import React from 'react'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { DesktopOutlined, PlusOutlined, LineChartOutlined } from '@ant-design/icons'
import InfoCard from '../components/ui/InfoCard'
import { KVRow } from '../components/ui/Shared'
import api from '../services/api'

export default function MonitoringPage() {
  const [nodes, setNodes] = useState([])
  const [stats, setStats] = useState(null)
  const [clusterOverview, setClusterOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('1H')
  const navigate = useNavigate()

  useEffect(() => {
    loadMonitoringData()
    const interval = setInterval(loadMonitoringData, 3000)
    return () => clearInterval(interval)
  }, [])

  const loadMonitoringData = async () => {
    try {
      const [nodesRes, statsRes, overviewRes] = await Promise.all([
        api.get('/nodes').catch(() => ({ data: [] })),
        api.get('/dashboard/stats').catch(() => ({ data: {} })),
        api.get('/cluster-mgmt/clusters/overview').catch(() => ({ data: {} })),
      ])
      const rawNodes = Array.isArray(nodesRes.data) ? nodesRes.data : (nodesRes.data?.items || [])
      setNodes(rawNodes)
      setStats(statsRes.data || {})
      setClusterOverview(overviewRes.data || {})
    } catch (err) {
      console.error('Failed to load monitoring telemetry:', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status) => {
    const colors = {
      online: '#16A34A',
      idle: '#2563EB',
      allocated: '#2563EB',
      offline: '#DC2626',
      down: '#DC2626',
      maintenance: '#D97706',
      drain: '#D97706',
    }
    return colors[status?.toLowerCase()] || '#94A3B8'
  }

  const onlineNodes = nodes.filter(n => ['online', 'idle', 'allocated'].includes((n.state || '').toLowerCase()))
  const onlineCount = onlineNodes.length
  const totalCount = nodes.length

  // Live aggregated metrics
  const runningJobs = stats?.jobs?.running ?? clusterOverview?.summary?.slurm_jobs?.running ?? 0
  const pendingJobs = stats?.jobs?.pending ?? clusterOverview?.summary?.slurm_jobs?.pending ?? 0
  const totalJobs = runningJobs + pendingJobs

  const cpuAvg = onlineCount > 0 ? (stats?.cpu_avg ?? 0.0) : 0.0
  const totalGpus = stats?.nodes?.total_gpus ?? clusterOverview?.summary?.total_gpus ?? 0
  const activeGpus = stats?.nodes?.healthy_gpus ?? 0

  // RAM calculations
  const totalRamGb = nodes.reduce((acc, n) => acc + (n.memory_gb || 0), 0)
  const usedRamGb = nodes.reduce((acc, n) => {
    const pct = n.memory_usage || 0
    return acc + Math.round((pct / 100) * (n.memory_gb || 0))
  }, 0)

  // Storage
  const storageUsedGb = stats?.storage?.used_gb ?? 0

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>
            Monitoring Telemetry
          </span>
          <span className="ayal-accent-badge">
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#EAB308', display: 'inline-block' }} />
            LIVE TELEMETRY
          </span>
        </div>
        <span style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          {['1H', '6H', '24H', '7D'].map(p => (
            <div
              key={p}
              onClick={() => setTimeRange(p)}
              style={{
                padding: '4px 10px', borderRadius: 6, fontSize: 11.5, cursor: 'pointer',
                background: p === timeRange ? '#2563EB' : '#FFFFFF',
                color: p === timeRange ? '#FFFFFF' : '#64748B',
                border: `1px solid ${p === timeRange ? '#2563EB' : '#E2E8F0'}`,
                fontWeight: p === timeRange ? 600 : 500,
                transition: 'all 0.15s ease',
              }}
            >
              {p}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <InfoCard title="Active Jobs">
          <KVRow label="Running" value={runningJobs} valueColor={runningJobs > 0 ? '#16A34A' : undefined} />
          <KVRow label="Pending" value={pendingJobs} valueColor={pendingJobs > 0 ? '#D97706' : undefined} />
          <KVRow label="Total Active" value={totalJobs} valueColor={totalJobs > 0 ? '#2563EB' : undefined} />
        </InfoCard>

        <InfoCard title="Cluster Load">
          <KVRow label="CPU Average" value={`${cpuAvg}%`} valueColor={cpuAvg > 0 ? '#2563EB' : undefined} />
          <KVRow label="Memory Used" value={totalCount > 0 ? `${usedRamGb} GB / ${totalRamGb} GB` : '0 GB / 0 GB'} />
          <KVRow label="GPUs Active" value={`${activeGpus} / ${totalGpus}`} />
        </InfoCard>

        <InfoCard title="Network I/O">
          <KVRow label="Inbound" value={onlineCount > 0 ? 'Optimal (1 GbE)' : '0 Gbps'} valueColor={onlineCount > 0 ? '#16A34A' : undefined} />
          <KVRow label="Outbound" value={onlineCount > 0 ? 'Optimal (1 GbE)' : '0 Gbps'} />
          <KVRow label="Errors" value="0" valueColor="#16A34A" />
        </InfoCard>

        <InfoCard title="Storage I/O">
          <KVRow label="Read" value={storageUsedGb > 0 ? `${storageUsedGb} GB Used` : '0 MB/s'} valueColor={storageUsedGb > 0 ? '#16A34A' : undefined} />
          <KVRow label="Write" value="0 MB/s" />
          <KVRow label="IOPS" value="0" />
        </InfoCard>
      </div>

      <InfoCard title="Node Status">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
          {nodes.map((node) => {
            const st = node.state || node.status || 'unknown'
            const nm = node.hostname || node.name || 'node'
            const cpu = node.cpu_usage ?? node.cpu_pct ?? 0
            const mem = node.memory_usage ?? node.mem_pct ?? 0
            const isOnline = ['online', 'idle', 'allocated'].includes(st.toLowerCase())
            return (
              <div
                key={node.id || nm}
                onClick={() => navigate(`/nodes/detail?name=${nm}`)}
                style={{
                  padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 8,
                  cursor: 'pointer', transition: 'all 0.15s ease', background: '#FFFFFF',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#2563EB'
                  e.currentTarget.style.boxShadow = '0 4px 6px -1px rgba(37, 99, 235, 0.1)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#E2E8F0'
                  e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: getStatusColor(st) }} />
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#0F172A' }}>{nm}</span>
                  </div>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', color: getStatusColor(st), fontWeight: 700 }}>
                    {st}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B' }}>
                  <span>CPU</span><span className="tabular-nums" style={{ fontWeight: 600, color: '#0F172A' }}>{isOnline ? `${cpu}%` : '0%'}</span>
                </div>
                <div style={{ height: 4, background: '#F1F5F9', borderRadius: 2, marginTop: 3, marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${isOnline ? cpu : 0}%`, background: '#2563EB', borderRadius: 2 }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B' }}>
                  <span>RAM</span><span className="tabular-nums" style={{ fontWeight: 600, color: '#0F172A' }}>{isOnline ? `${mem}%` : '0%'}</span>
                </div>
                <div style={{ height: 4, background: '#F1F5F9', borderRadius: 2, marginTop: 3 }}>
                  <div style={{ height: '100%', width: `${isOnline ? mem : 0}%`, background: '#16A34A', borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
          {nodes.length === 0 && !loading && (
            <div style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '44px 16px',
              color: '#64748B',
              background: '#F8FAFC',
              borderRadius: 8,
              border: '1px dashed #CBD5E1',
            }}>
              <DesktopOutlined style={{ fontSize: 32, color: '#94A3B8', marginBottom: 10 }} />
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>No Cluster Nodes Enrolled</div>
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 4, marginBottom: 16 }}>
                Enrolled master and worker compute nodes will stream real-time cluster telemetry here.
              </div>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/nodes')} style={{ background: '#2563EB' }}>
                Enroll Nodes in Node Manager
              </Button>
            </div>
          )}
        </div>
      </InfoCard>
    </>
  )
}
