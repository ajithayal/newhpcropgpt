import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import {
  Card, Button, Row, Col, Typography, Space, Tag, Alert, Table, message, Spin
} from 'antd'
import {
  SafetyCertificateOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, ThunderboltOutlined, DesktopOutlined, DatabaseOutlined,
  SettingOutlined, CodeOutlined, CloudServerOutlined, ArrowLeftOutlined,
  ToolOutlined, ReloadOutlined, HddOutlined
} from '@ant-design/icons'
import { clusterMgmtAPI, clusterAPI } from '../services/api'

const { Title, Text } = Typography

export default function ClusterHealthPage() {
  const navigate = useNavigate()
  const { clusterId } = useParams()
  const [searchParams] = useSearchParams()
  const activeClusterId = clusterId || searchParams.get('id') || null

  const [cluster, setCluster] = useState(null)
  const [loading, setLoading] = useState(true)
  const [healthData, setHealthData] = useState(null)
  const [fixingLayer, setFixingLayer] = useState(null)

  useEffect(() => {
    loadHealthAudit()
  }, [activeClusterId])

  const loadHealthAudit = async () => {
    setLoading(true)
    try {
      const [cRes, hRes] = await Promise.all([
        clusterAPI.getOverview().catch(() => ({ data: { clusters: [] } })),
        clusterMgmtAPI.getHealthAudit(activeClusterId).catch(() => null),
      ])
      const list = cRes.data?.clusters || []
      const found = list.find(c => c.id === activeClusterId || c.cluster_id === activeClusterId) || list[0]
      if (found) setCluster(found)

      if (hRes && hRes.data) {
        setHealthData(hRes.data)
      } else {
        setHealthData({
          is_configured: false,
          healthy_count: 0,
          total_count: 0,
          cluster_skew: 'N/A',
          layers: []
        })
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleFixLayer = async (layerId, actionName) => {
    setFixingLayer(layerId)
    try {
      await clusterMgmtAPI.fixHealthLayer(activeClusterId, layerId)
      message.success(`Automated remediation successful: ${actionName}`)
      await loadHealthAudit()
    } catch (err) {
      message.error(`Remediation failed: ${err.message}`)
    } finally {
      setFixingLayer(null)
    }
  }

  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', path: `/cluster/overview?id=${activeClusterId}` },
    { key: 'nodes', label: 'Node Management', path: `/cluster/nodes?id=${activeClusterId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${activeClusterId}` },
    { key: 'terminal', label: 'Terminal', path: `/cluster/terminal?id=${activeClusterId}` },
    { key: 'slurm', label: 'Slurm Configuration', path: `/cluster/slurm?id=${activeClusterId}` },
    { key: 'health', label: 'Cluster Health', active: true, path: `/cluster/health?id=${activeClusterId}` },
    { key: 'storage', label: 'Storage', path: `/cluster/storage?id=${activeClusterId}` },
  ]

  const layers = healthData?.layers || []
  const totalCount = healthData?.total_count || 0
  const healthyCount = healthData?.healthy_count || 0
  const isAuditActive = totalCount > 0
  const healthScore = healthData?.health_score ?? (isAuditActive ? Math.round((healthyCount / totalCount) * 100) : 0)
  const clusterSkew = isAuditActive ? (healthData?.cluster_skew || 'N/A') : 'N/A'

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40, color: '#172033' }}>
      {/* ── BREADCRUMB & HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748B' }}>
          <SafetyCertificateOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/cluster')}>Cluster</span>
          <span>&gt;</span>
          <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>{cluster?.name || 'Cluster Health'}</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A' }}>Cluster Health &amp; 8-Layer Infrastructure Matrix</span>
        </div>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>
            Back to Overview
          </Button>
          <Button icon={<ReloadOutlined spin={loading} />} onClick={loadHealthAudit}>
            Rerun Health Audit
          </Button>
        </Space>
      </div>

      {/* ── SUB-NAV BAR (Light Enterprise Option B) ── */}
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
              padding: '12px 16px', fontSize: 13,
              fontWeight: tab.active ? 700 : 500,
              color: tab.active ? '#2563EB' : '#64748B',
              borderBottom: tab.active ? '2.5px solid #2563EB' : '2.5px solid transparent',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
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
      </div>

      {/* ── SUMMARY BANNER (Light Enterprise Card) ── */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 12, padding: '20px 24px', border: '1px solid #E2E8F0',
        marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
              8-Layer Infrastructure Health Audit
            </span>
            <Tag color={isAuditActive && healthyCount === totalCount ? 'success' : (healthyCount > 0 ? 'warning' : 'default')} style={{ fontWeight: 700 }}>
              {healthyCount} / {totalCount} Layers Passed
            </Tag>
          </div>
          <div style={{ fontSize: 13, color: '#64748B' }}>
            Continuous real-time validation across Time Sync, Agent Heartbeats, FreeIPA, Shared NFS Storage, Munge, and Slurm Daemons.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16 }}>
          <div style={{ textAlign: 'center', background: '#F8FAFC', padding: '10px 18px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: isAuditActive ? (healthScore >= 80 ? '#16A34A' : '#EAB308') : '#94A3B8' }}>
              {isAuditActive ? `${healthScore}%` : '0%'}
            </div>
            <div style={{ fontSize: 11, color: '#64748B' }}>Health Score</div>
          </div>
          <div style={{ textAlign: 'center', background: '#F8FAFC', padding: '10px 18px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: isAuditActive ? '#2563EB' : '#94A3B8' }}>{clusterSkew}</div>
            <div style={{ fontSize: 11, color: '#64748B' }}>Cluster Skew</div>
          </div>
        </div>
      </div>

      {/* ── 8 LAYERS MATRIX ── */}
      {layers.length === 0 ? (
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: 36,
          border: '1px dashed #CBD5E1', textAlign: 'center', color: '#64748B', marginBottom: 24
        }}>
          <SafetyCertificateOutlined style={{ fontSize: 40, color: '#94A3B8', marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 6 }}>
            No Active Nodes Registered for Health Audit
          </div>
          <div style={{ fontSize: 13, color: '#64748B', maxWidth: 520, margin: '0 auto 16px' }}>
            The 8-Layer Infrastructure Health Audit runs real-time checks across Time Sync, Agent Daemons, Introspection, FreeIPA, Shared NFS Storage, Munge, and Slurm. Configure your cluster nodes to begin validation.
          </div>
          <Button type="primary" onClick={() => navigate('/cluster/config')} style={{ background: '#2563EB' }}>
            + Configure Cluster &amp; Nodes
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {layers.map((layer) => {
            const isPassed = layer.status === 'PASSED'
            return (
              <div
                key={layer.id}
                style={{
                  background: '#FFFFFF', borderRadius: 10, padding: '14px 20px',
                  border: `1px solid ${isPassed ? '#E2E8F0' : '#FECACA'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: isPassed ? '#DCFCE7' : '#FEE2E2',
                    color: isPassed ? '#16A34A' : '#DC2626',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13
                  }}>
                    {layer.layer_number}
                  </div>

                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#172033' }}>
                        {layer.name}
                      </span>
                      <Tag color={isPassed ? 'success' : 'error'}>{layer.status}</Tag>
                      <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
                        latency: {layer.latency}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      {layer.message}
                    </div>
                  </div>
                </div>

                <Space>
                  <Button
                    size="small"
                    icon={<ToolOutlined />}
                    loading={fixingLayer === layer.id}
                    onClick={() => handleFixLayer(layer.id, layer.fix_action)}
                  >
                    {layer.fix_action}
                  </Button>
                </Space>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
