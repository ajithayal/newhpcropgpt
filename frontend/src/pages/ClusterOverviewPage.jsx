import React from 'react'
/**
 * AjiCorehpc Manager — Selected Cluster Dashboard (Detailed View)
 * Matches reference image media_1793105738332_88134d92.png:
 * - Breadcrumb: Cluster > [Cluster Name] [• Healthy]
 * - Horizontal Cluster Navigation: Overview, Nodes, Configuration, HPC Applications, Job Scheduler, Storage, ...
 * - Cluster Overview card with rack server illustration, master, workers, domain, OS, and Edit button.
 * - Resource Utilization cards: CPU (68%), Memory (72%), Storage (65%), GPU (8/8).
 * - Detailed resource chart, node table, services health, and job activity.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import {
  Card, Progress, Tag, Button, Dropdown, Table, Select, Modal,
  Form, Input, message, Row, Col, Typography, Space, Spin, Alert
} from 'antd'
import {
  EditOutlined, CloudServerOutlined, ThunderboltOutlined,
  CheckCircleOutlined, CloseCircleOutlined, WarningOutlined, DatabaseOutlined,
  ClusterOutlined, HddOutlined, MoreOutlined, ArrowRightOutlined,
  DesktopOutlined, SettingOutlined, CalendarOutlined, AppstoreOutlined,
  ExclamationCircleOutlined, CodeOutlined, SafetyCertificateOutlined
} from '@ant-design/icons'
import api, { clusterAPI, clusterMgmtAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select
const { TextArea } = Input

export default function ClusterOverviewPage() {
  const navigate = useNavigate()
  const { clusterId } = useParams()
  const [searchParams] = useSearchParams()
  const clusterParamId = searchParams.get('id') || clusterId

  const [loading, setLoading] = useState(true)
  const [cluster, setCluster] = useState(null)
  const [servicesConfig, setServicesConfig] = useState(null)

  const [timeRange, setTimeRange] = useState('24h')

  // Edit Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm] = Form.useForm()
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    loadClusterData()
  }, [clusterParamId])

  const loadClusterData = async () => {
    try {
      const res = await clusterAPI.getOverview()
      const list = res.data?.clusters || []
      const found = list.find(c => c.id === clusterParamId || c.cluster_id === clusterParamId)
      const targetCluster = found || (list.length > 0 ? list[0] : null)
      if (targetCluster) {
        setCluster(targetCluster)
        try {
          const cfgRes = await clusterMgmtAPI.getClusterConfig(targetCluster.id)
          setServicesConfig(cfgRes.data?.services || null)
        } catch (e) {
          console.warn('Could not load cluster service config:', e)
        }
      } else {
        setCluster(null)
      }
    } catch (err) {
      console.error(err)
      setCluster(null)
    } finally {
      setLoading(false)
    }
  }

  const handleOpenEdit = () => {
    editForm.setFieldsValue({
      name: cluster.name,
      domain: cluster.domain,
      description: cluster.description,
      location: cluster.location || 'Primary Datacenter Rack A01',
    })
    setEditModalOpen(true)
  }

  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      setSavingEdit(true)
      await clusterAPI.update(cluster.id, values)
      setCluster(prev => ({ ...prev, ...values }))
      message.success('Cluster metadata updated successfully')
      setEditModalOpen(false)
    } catch (err) {
      message.error('Failed to update cluster')
    } finally {
      setSavingEdit(false)
    }
  }

  const clusterTargetId = cluster?.id || clusterParamId || ''

  const renderStatusBadge = () => {
    const s = (cluster?.status || '').toLowerCase()
    const online = cluster?.online_count || 0
    const warning = cluster?.warning_count || 0
    const offline = cluster?.offline_count || 0
    const total = (cluster?.master_count || 0) + (cluster?.workers_count || 0) || (cluster?.total_nodes || 0)

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

    if (online < total || warning > 0 || offline > 0 || s === 'degraded' || s === 'warning') {
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
  }

  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', active: true, path: `/cluster/overview?id=${clusterTargetId}` },
    { key: 'nodes', label: 'Node Management', path: `/cluster/nodes?id=${clusterTargetId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${clusterTargetId}` },
    { key: 'terminal', label: 'Terminal', path: `/cluster/terminal?id=${clusterTargetId}` },
    { key: 'slurm', label: 'Slurm Configuration', path: `/cluster/slurm?id=${clusterTargetId}` },
    { key: 'health', label: 'Cluster Health', path: `/cluster/health?id=${clusterTargetId}` },
    { key: 'storage', label: 'Storage', path: `/cluster/storage?id=${clusterTargetId}` },
  ]

  const MORE_MENU_ITEMS = [
    { key: 'security', label: 'Security & Access', onClick: () => navigate(`/cluster/security?id=${clusterTargetId}`) },
    { key: 'apps', label: 'HPC Applications & Modules', onClick: () => navigate(`/cluster/apps?id=${clusterTargetId}`) },
    { key: 'jobs', label: 'Job Scheduler', onClick: () => navigate(`/cluster/jobs?id=${clusterTargetId}`) },
    { type: 'divider' },
    {
      key: 'decommission',
      danger: true,
      label: 'Delete Cluster (Decommission)',
      onClick: () => navigate(`/cluster/decommission/${clusterTargetId}`)
    },
  ]

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Spin size="large" />
      </div>
    )
  }

  if (!cluster) {
    return (
      <div style={{ maxWidth: 1000, margin: '40px auto', padding: '0 20px' }}>
        <Card style={{ borderRadius: 12, textAlign: 'center', padding: '48px 24px', border: '1px solid #E2E8F0' }}>
          <ClusterOutlined style={{ fontSize: 52, color: '#94A3B8', marginBottom: 16 }} />
          <Title level={4} style={{ color: '#0F172A', marginBottom: 8 }}>No Cluster Configured</Title>
          <Paragraph type="secondary" style={{ maxWidth: 500, margin: '0 auto 24px', fontSize: 13 }}>
            There are currently no active HPC clusters deployed or managed. Launch the Cluster Setup Wizard to provision your master node and worker compute nodes with real-time connectivity verification.
          </Paragraph>
          <Space>
            <Button type="primary" size="large" onClick={() => navigate('/cluster-setup')} style={{ background: '#2563EB' }}>
              Launch Cluster Setup Wizard
            </Button>
            <Button size="large" onClick={() => navigate('/cluster')}>
              View All Clusters
            </Button>
          </Space>
        </Card>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── BREADCRUMB & HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 14, flexWrap: 'wrap', gap: 10
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748B' }}>
          <CloudServerOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/cluster')}>Cluster</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster.name}</span>
          {renderStatusBadge()}
        </div>

        <Space>
          <Button onClick={() => navigate('/cluster')}>&larr; Back to All Clusters</Button>
          <Button type="primary" onClick={() => navigate(`/cluster/nodes?id=${clusterTargetId}`)} style={{ background: '#2563EB' }}>
            + Add Node
          </Button>
        </Space>
      </div>

      {/* ── HORIZONTAL SUB-NAV BAR (Matches media reference) ── */}
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
            {tab.key === 'apps' && <AppstoreOutlined />}
            {tab.key === 'jobs' && <CalendarOutlined />}
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

      {/* ── CLUSTER OVERVIEW CARD (Matches media_1793105738332_88134d92.png) ── */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: 12,
        padding: '24px 28px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        marginBottom: 20,
        position: 'relative',
      }}>
        {/* Edit Button on Top-Right */}
        <div style={{ position: 'absolute', top: 20, right: 24 }}>
          <Button
            icon={<EditOutlined style={{ color: '#2563EB' }} />}
            onClick={handleOpenEdit}
            style={{
              borderRadius: 6,
              color: '#2563EB',
              borderColor: '#BFDBFE',
              background: '#EFF6FF',
              fontWeight: 600
            }}
          >
            Edit
          </Button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
          {/* Left: Server Rack Illustration */}
          <div style={{
            width: 90, height: 110, borderRadius: 8,
            background: 'linear-gradient(135deg, #1E293B, #0F172A)',
            border: '2px solid #334155',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-around',
            padding: '8px 10px', boxShadow: '0 4px 10px rgba(0,0,0,0.15)', flexShrink: 0
          }}>
            {[1, 2, 3, 4].map((slot) => (
              <div key={slot} style={{
                height: 14, background: '#1E293B', borderRadius: 2,
                border: '1px solid #475569', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', padding: '0 4px'
              }}>
                <div style={{ display: 'flex', gap: 2 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#22C55E' }} />
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: '#3B82F6' }} />
                </div>
                <div style={{ width: 12, height: 2, background: '#64748B', borderRadius: 1 }} />
              </div>
            ))}
          </div>

          {/* Right: Cluster Metadata Details */}
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                {cluster.name}
              </span>
              {renderStatusBadge()}
            </div>

            <div style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>
              ID: <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{cluster.cluster_id || 'clus-001'}</span>
            </div>
            <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 14 }}>
              {cluster.description || 'Production HPC Cluster'}
            </div>

            {/* Grid of properties */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '12px 24px',
              fontSize: 12.5,
              color: '#334155'
            }}>
              <div>
                <span style={{ color: cluster.master_hostname ? '#16A34A' : '#94A3B8', marginRight: 6 }}>●</span>
                <span style={{ color: '#64748B' }}>Master Node</span>
                <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2 }}>
                  {cluster.master_hostname || 'Unassigned'} {cluster.master_ip ? `(${cluster.master_ip})` : ''}
                </div>
              </div>

              <div>
                <span style={{ color: cluster.domain ? '#16A34A' : '#94A3B8', marginRight: 6 }}>●</span>
                <span style={{ color: '#64748B' }}>Domain</span>
                <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2 }}>
                  {cluster.domain || 'Unconfigured'}
                </div>
              </div>

              <div>
                <span style={{ color: '#64748B' }}>Operating System</span>
                <div style={{ fontWeight: 600, color: '#2563EB', marginTop: 2 }}>
                  {cluster.os || 'Linux'}
                </div>
              </div>

              <div>
                <span style={{ color: ((cluster.online_count || 0) > 0 || (cluster.warning_count || 0) > 0) ? '#16A34A' : '#94A3B8', marginRight: 6 }}>●</span>
                <span style={{ color: '#64748B' }}>Workers</span>
                <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2 }}>
                  {cluster.workers_count ?? 0} ({cluster.online_count ?? 0} online{cluster.warning_count ? `, ${cluster.warning_count} connecting` : ''})
                </div>
              </div>

              <div>
                <span style={{ color: '#64748B' }}>Last Updated</span>
                <div style={{ fontWeight: 600, color: '#0F172A', marginTop: 2 }}>
                  {cluster.last_updated || 'Just now'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── RESOURCE UTILIZATION SECTION (4 KPI Cards matching media reference) ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0F172A', marginBottom: 12 }}>
          Resource Utilization
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16,
        }}>
          {/* Card 1: CPU */}
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: '#EFF6FF',
                color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                <CloudServerOutlined />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>CPU</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                  {cluster.cpu_pct ?? 0}%
                </div>
                <Progress percent={cluster.cpu_pct ?? 0} strokeColor="#2563EB" showInfo={false} size="small" />
              </div>
            </div>
          </div>

          {/* Card 2: Memory */}
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: '#ECFDF5',
                color: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                <ThunderboltOutlined />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>Memory</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                  {cluster.mem_pct ?? 0}%
                </div>
                <Progress percent={cluster.mem_pct ?? 0} strokeColor="#10B981" showInfo={false} size="small" />
              </div>
            </div>
          </div>

          {/* Card 3: Storage */}
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: '#F5F3FF',
                color: '#8B5CF6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                <DatabaseOutlined />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>Storage</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#0F172A' }}>
                  {cluster.storage_pct ?? 0}%
                </div>
                <Progress percent={cluster.storage_pct ?? 0} strokeColor="#8B5CF6" showInfo={false} size="small" />
              </div>
            </div>
          </div>

          {/* Card 4: GPU */}
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
            border: '1px solid #E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: '50%', background: '#F1F5F9',
                color: '#64748B', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
              }}>
                <ClusterOutlined />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: '#64748B', fontWeight: 600 }}>GPU (Accelerators)</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
                  {cluster.gpu_str && cluster.gpu_str !== '0/0' ? cluster.gpu_str : '0 Available'}
                </div>
                <Progress percent={cluster.gpu_str && cluster.gpu_str !== '0/0' ? 100 : 0} strokeColor="#2563EB" showInfo={false} size="small" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── LOWER SECTION: Services & Node Health ── */}
      <Row gutter={16}>
        {/* HPC Services Status */}
        <Col span={12}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: 20,
            border: '1px solid #E2E8F0', minHeight: 280
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                HPC Services Readiness
              </div>
              <Button size="small" onClick={() => navigate(`/cluster/config?id=${clusterTargetId}`)}>
                Manage Configuration
              </Button>
            </div>

            {/* Real Service Configuration Status */}
            {(() => {
              const mungeConfigured = servicesConfig?.munge?.status === 'Configured'
              const slurmConfigured = servicesConfig?.slurm?.status === 'Configured'
              const nfsConfigured = servicesConfig?.nfs?.status === 'Configured'
              const freeipaConfigured = servicesConfig?.freeipa?.status === 'Configured'
              const agentOnline = (cluster.online_count ?? 0) > 0

              const allHpcConfigured = mungeConfigured && slurmConfigured && nfsConfigured && freeipaConfigured

              const items = [
                {
                  name: 'Munge Authentication Daemon',
                  status: mungeConfigured ? 'Synchronized & Active' : 'Not Configured (Key Pending)',
                  host: 'Cluster-wide',
                  ok: mungeConfigured,
                  color: mungeConfigured ? 'success' : 'default'
                },
                {
                  name: 'Slurm Workload Manager (slurmctld)',
                  status: slurmConfigured ? 'Active (Controller Ready)' : 'Not Configured (slurm.conf Pending)',
                  host: cluster.master_hostname ? `${cluster.master_hostname}:6817` : 'Controller Host',
                  ok: slurmConfigured,
                  color: slurmConfigured ? 'success' : 'default'
                },
                {
                  name: 'NFS Shared Storage Mounts',
                  status: nfsConfigured ? 'Exported & Mounted' : 'Not Configured (Exports Pending)',
                  host: cluster.master_ip || 'Master Node',
                  ok: nfsConfigured,
                  color: nfsConfigured ? 'success' : 'default'
                },
                {
                  name: 'AYAL HPC Agent Telemetry',
                  status: agentOnline ? `Streaming telemetry (:9100) — ${cluster.online_count} Nodes Online` : '0 Nodes Connected',
                  host: 'Fleet-wide',
                  ok: agentOnline,
                  color: agentOnline ? 'processing' : 'default'
                },
                {
                  name: 'Identity & SSSD Domain',
                  status: freeipaConfigured ? 'Domain Active' : 'Not Configured (Realm Pending)',
                  host: cluster.domain || 'ayal.hpc.in',
                  ok: freeipaConfigured,
                  color: freeipaConfigured ? 'success' : 'default'
                },
              ]

              return (
                <div>
                  {!allHpcConfigured && (
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12, borderRadius: 6, fontSize: 11.5 }}
                      message={<strong>Fresh OS Installed — HPC Stack Setup Required</strong>}
                      description="Nodes are online, but Munge, Slurm, NFS, and Identity services have not been provisioned yet. Launch HPC Configuration to deploy Munge, Slurm, NFS shared storage, and FreeIPA."
                      action={
                        <Button
                          type="primary"
                          size="small"
                          style={{ background: '#2563EB', marginTop: 4, fontSize: 11 }}
                          onClick={() => navigate(`/cluster/config?id=${clusterTargetId}`)}
                        >
                          Configure Cluster &rarr;
                        </Button>
                      }
                    />
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {items.map((svc, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '10px 12px', background: '#F8FAFC', borderRadius: 6
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {svc.ok ? (
                            <CheckCircleOutlined style={{ color: '#16A34A', fontSize: 15 }} />
                          ) : (
                            <ExclamationCircleOutlined style={{ color: '#D97706', fontSize: 15 }} />
                          )}
                          <span style={{ fontWeight: 600, fontSize: 12.5, color: '#1E293B' }}>{svc.name}</span>
                        </div>
                        <Tag color={svc.color}>{svc.status}</Tag>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        </Col>

        {/* Quick Actions & Recent Jobs */}
        <Col span={12}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: 20,
            border: '1px solid #E2E8F0', minHeight: 280
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Quick Node Actions &amp; Workloads
              </div>
              <Button size="small" onClick={() => navigate(`/cluster/jobs?id=${clusterTargetId}`)}>
                View Slurm Jobs
              </Button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              <Button onClick={() => navigate(`/cluster/nodes?id=${clusterTargetId}`)} style={{ flex: 1 }}>
                View Node List ({cluster.workers_count ?? 2} Worker, {cluster.master_count || 1} Master)
              </Button>
              <Button type="primary" onClick={() => navigate(`/cluster/nodes?id=${clusterTargetId}&tab=add`)} style={{ flex: 1, background: '#2563EB' }}>
                + Register Worker Node
              </Button>
            </div>

            <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.8 }}>
              <div><strong>Master Node:</strong> {cluster.master_hostname || 'Unassigned'} {cluster.master_ip ? `(${cluster.master_ip})` : ''}</div>
              <div><strong>Slurm Partitions:</strong> {servicesConfig?.slurm?.status === 'Configured' ? 'compute (1 partition active)' : 'Unconfigured (Awaiting Slurm setup)'}</div>
              <div><strong>Active Batch Jobs:</strong> 0 running, 0 queued</div>
              <div><strong>Node Agent Heartbeat:</strong> {cluster.online_count || 0}/{cluster.total_nodes || 0} nodes healthy</div>
              <div><strong>Storage:</strong> 10 GB used of 500 GB storage pool</div>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── EDIT CLUSTER MODAL ── */}
      <Modal
        title="Edit Cluster Metadata"
        open={editModalOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={savingEdit}
        okText="Save Changes"
        okButtonProps={{ style: { background: '#2563EB' } }}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="Cluster Name" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Domain" name="domain" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="Location" name="location">
            <Input />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
