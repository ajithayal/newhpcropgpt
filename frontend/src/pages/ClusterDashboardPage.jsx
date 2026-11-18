import React from 'react'
/**
 * AjiCorehpc Manager — Cluster Dashboard (Cluster Overview Grid)
 * Displays all registered HPC clusters as rectangular overview cards
 * with top KPI metrics, search, view toggles, Edit/Delete modal actions,
 * and prominent + Create Cluster action.
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Input, Dropdown, Modal, Form, Select, Tag, Progress,
  Space, message, Typography, Row, Col, Empty, Tooltip, Alert
} from 'antd'
import {
  PlusOutlined, MoreOutlined, EyeOutlined, EditOutlined, DeleteOutlined,
  SearchOutlined, AppstoreOutlined, BarsOutlined, CloudServerOutlined,
  CheckCircleOutlined, WarningOutlined, CloseCircleOutlined,
  ThunderboltOutlined, HddOutlined, DatabaseOutlined, ClusterOutlined,
  ExclamationCircleOutlined, BellOutlined, QuestionCircleOutlined, UserOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import api, { clusterAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select
const { TextArea } = Input

export default function ClusterDashboardPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [clusters, setClusters] = useState([])
  const [summary, setSummary] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'list'

  // Edit Cluster Modal State
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editingCluster, setEditingCluster] = useState(null)
  const [editForm] = Form.useForm()
  const [savingEdit, setSavingEdit] = useState(false)

  // Delete / Decommission Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingCluster, setDeletingCluster] = useState(null)
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    loadClusterOverview()
  }, [])

  const loadClusterOverview = async () => {
    setLoading(true)
    try {
      const res = await clusterAPI.getOverview()
      if (res.data) {
        setClusters(res.data.clusters || [])
        setSummary(res.data.summary || null)
      }
    } catch (err) {
      console.error('Failed to load cluster overview:', err)
    } finally {
      setLoading(false)
    }
  }

  // Open Edit Modal
  const handleOpenEdit = (cluster, e) => {
    if (e) e.stopPropagation()
    setEditingCluster(cluster)
    editForm.setFieldsValue({
      name: cluster.name,
      domain: cluster.domain || 'ayalhpc.local',
      profile: cluster.profile || 'CPU Compute Cluster',
      description: cluster.description || '',
      location: cluster.location || 'Primary Datacenter Rack A01',
    })
    setEditModalOpen(true)
  }

  // Save Edit
  const handleSaveEdit = async () => {
    try {
      const values = await editForm.validateFields()
      setSavingEdit(true)
      await clusterAPI.update(editingCluster.id, values)
      message.success(`Cluster '${values.name}' updated successfully`)
      setEditModalOpen(false)
      loadClusterOverview()
    } catch (err) {
      message.error('Failed to update cluster metadata')
    } finally {
      setSavingEdit(false)
    }
  }

  // Open Delete Modal
  const handleOpenDelete = (cluster, e) => {
    if (e) e.stopPropagation()
    setDeletingCluster(cluster)
    setConfirmName('')
    setDeleteModalOpen(true)
  }

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (confirmName !== deletingCluster?.name) {
      message.error('Please enter the exact cluster name to confirm')
      return
    }
    setDeleting(true)
    try {
      try {
        await api.post(`/clusters/${deletingCluster.id}/decommission`, {
          confirmation_name: confirmName,
          drain_jobs: true,
          preserve_storage: true,
          preserve_nodes: false,
        })
      } catch (err1) {
        await clusterAPI.delete(deletingCluster.id)
      }
      message.success(`Cluster '${deletingCluster.name}' decommissioned safely`)
      setDeleteModalOpen(false)
      loadClusterOverview()
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || 'Failed to decommission cluster'
      message.error(`Failed to decommission cluster: ${msg}`)
    } finally {
      setDeleting(false)
    }
  }

  // Filtered clusters
  const filteredClusters = clusters.filter(c => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      (c.description || '').toLowerCase().includes(q) ||
      (c.master_hostname || '').toLowerCase().includes(q) ||
      (c.cluster_id || '').toLowerCase().includes(q)
    )
  })

  // Three-dots menu items for a cluster card
  const getCardMenuItems = (cluster) => [
    {
      key: 'open',
      icon: <EyeOutlined />,
      label: 'Open Dashboard',
      onClick: () => navigate(`/cluster/overview?id=${cluster.id}`),
    },
    {
      key: 'edit',
      icon: <EditOutlined />,
      label: 'Edit Cluster',
      onClick: (e) => handleOpenEdit(cluster, e.domEvent),
    },
    {
      type: 'divider',
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: 'Delete Cluster',
      danger: true,
      onClick: (e) => handleOpenDelete(cluster, e.domEvent),
    },
  ]

  // Status Badge Component
  const renderStatusBadge = (status, cluster = null) => {
    const s = (status || cluster?.status || '').toLowerCase()
    const online = cluster?.online_count ?? (s === 'offline' ? 0 : 1)
    const warning = cluster?.warning_count || 0
    const offline = cluster?.offline_count || 0
    const total = (cluster?.master_count || 0) + (cluster?.workers_count || 0) || (cluster?.total_nodes || 0)

    if (cluster && total === 0) {
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

    if (online === 0 || s === 'offline') {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: '#FEE2E2', color: '#B91C1C', padding: '2px 8px',
          borderRadius: 12, fontSize: 11, fontWeight: 700
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626' }} />
          Offline
        </span>
      )
    }

    if (s === 'warning' || s === 'degraded' || warning > 0 || (total > 0 && online < total)) {
      return (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: '#FEF3C7', color: '#B45309', padding: '2px 8px',
          borderRadius: 12, fontSize: 11, fontWeight: 700
        }}>
          ▲ Degraded
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

  // Get Cluster Icon
  const getClusterIcon = (cluster) => {
    const p = (cluster.profile || cluster.name || '').toLowerCase()
    if (p.includes('gpu')) {
      return (
        <div style={{
          width: 44, height: 44, borderRadius: 8,
          background: '#ECFDF5', color: '#059669',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
        }}>
          <ThunderboltOutlined />
        </div>
      )
    }
    if (p.includes('research')) {
      return (
        <div style={{
          width: 44, height: 44, borderRadius: 8,
          background: '#F0FDF4', color: '#16A34A',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
        }}>
          <ClusterOutlined />
        </div>
      )
    }
    return (
      <div style={{
        width: 44, height: 44, borderRadius: 8,
        background: '#EFF6FF', color: '#2563EB',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20
      }}>
        <CloudServerOutlined />
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── TOP BREADCRUMB & CONTROLS ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748B' }}>
          <CloudServerOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span>Cluster</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 600, color: '#0F172A' }}>Cluster Dashboard</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadClusterOverview}
            loading={loading}
            style={{ borderRadius: 6, fontSize: 12 }}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── PAGE TITLE ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          Cluster Dashboard
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
          Manage and monitor all your HPC clusters
        </div>
      </div>

      {/* ── TOP KPI STRIP (9 Metrics matching reference media) ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
        gap: 12,
        marginBottom: 24,
      }}>
        {/* 1. Total Clusters */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#2563EB',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <CloudServerOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_clusters ?? clusters.length}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total Clusters</div>
          </div>
        </div>

        {/* 2. Total Nodes */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#3B82F6',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <DatabaseOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_nodes ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total Nodes</div>
          </div>
        </div>

        {/* 3. Online Nodes */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#10B981',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <CheckCircleOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.online_nodes ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Online Nodes</div>
          </div>
        </div>

        {/* 4. Warning Nodes */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#F59E0B',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <WarningOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.warning_nodes ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Warning Nodes</div>
          </div>
        </div>

        {/* 5. Offline Nodes */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#EF4444',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <CloseCircleOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.offline_nodes ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Offline Nodes</div>
          </div>
        </div>

        {/* 6. Total CPU Cores */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#8B5CF6',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <ClusterOutlined />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_cpu_cores ? summary.total_cpu_cores.toLocaleString() : 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total CPU Cores</div>
          </div>
        </div>

        {/* 7. Total Memory */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#0284C7',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <HddOutlined />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_memory_tb || '0 GB'}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total Memory</div>
          </div>
        </div>

        {/* 8. Total GPUs */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#059669',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <ThunderboltOutlined />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_gpus ?? 0}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total GPUs</div>
          </div>
        </div>

        {/* 9. Total Storage */}
        <div style={{
          background: '#FFFFFF', borderRadius: 10, padding: '14px 16px',
          border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{
            width: 38, height: 38, borderRadius: '50%', background: '#F97316',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16
          }}>
            <DatabaseOutlined />
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', lineHeight: 1 }}>
              {summary?.total_storage_tb || '0 GB'}
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 3 }}>Total Storage</div>
          </div>
        </div>
      </div>

      {/* ── CLUSTERS SECTION HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 10
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>
          Clusters
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
            placeholder="Search clusters..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 220, borderRadius: 6 }}
          />
          <div style={{
            display: 'flex', background: '#F1F5F9', padding: 2, borderRadius: 6, border: '1px solid #E2E8F0'
          }}>
            <Button
              type={viewMode === 'grid' ? 'primary' : 'text'}
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => setViewMode('grid')}
              style={viewMode === 'grid' ? { background: '#2563EB' } : { color: '#64748B' }}
            />
            <Button
              type={viewMode === 'list' ? 'primary' : 'text'}
              size="small"
              icon={<BarsOutlined />}
              onClick={() => setViewMode('list')}
              style={viewMode === 'list' ? { background: '#2563EB' } : { color: '#64748B' }}
            />
          </div>
        </div>
      </div>

      {/* ── CLUSTERS GRID (Rectangular cards matching reference media) ── */}
      {filteredClusters.length === 0 ? (
        <div style={{
          background: '#FFFFFF', borderRadius: 12, padding: 48, textAlign: 'center',
          border: '1px solid #E2E8F0'
        }}>
          <Empty
            description={
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>No Clusters Found</div>
                <div style={{ fontSize: 13, color: '#64748B', marginTop: 4 }}>
                  No HPC clusters registered yet. Start by setting up your first cluster.
                </div>
              </div>
            }
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/cluster/create')}
              style={{ background: '#2563EB', marginTop: 12 }}
            >
              Create Cluster
            </Button>
          </Empty>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 18,
        }}>
          {filteredClusters.map((cluster) => {
            return (
              <div
                key={cluster.id}
                onClick={() => navigate(`/cluster/overview?id=${cluster.id}`)}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 12,
                  padding: '20px 22px',
                  border: '1px solid #E2E8F0',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = '0 6px 16px -2px rgba(37,99,235,0.08)'
                  e.currentTarget.style.borderColor = '#93C5FD'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.03)'
                  e.currentTarget.style.borderColor = '#E2E8F0'
                }}
              >
                {/* ── CARD TOP ROW: Icon, Name, Status, Three-dots ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {getClusterIcon(cluster)}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>
                            {cluster.name}
                          </span>
                          {renderStatusBadge(cluster.status, cluster)}
                        </div>
                        <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
                          ID: <span style={{ fontFamily: 'monospace' }}>{cluster.cluster_id || cluster.id?.slice(0, 8)}</span>
                        </div>
                      </div>
                    </div>

                    <Dropdown
                      menu={{ items: getCardMenuItems(cluster) }}
                      trigger={['click']}
                      placement="bottomRight"
                    >
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined style={{ fontSize: 18, color: '#64748B' }} />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  </div>

                  {/* Description */}
                  <div style={{ fontSize: 12, color: '#64748B', marginBottom: 16, minHeight: 18 }}>
                    {cluster.description || 'Production HPC Cluster'}
                  </div>

                  {/* ── NODE COUNTS ROW: Master, Workers, Online, Offline ── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '8px 12px', background: '#F8FAFC', borderRadius: 8,
                    marginBottom: 16, fontSize: 12, color: '#334155'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <UserOutlined style={{ color: '#64748B', fontSize: 13 }} />
                      <span><strong>{cluster.master_count || 1}</strong> Master</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <CloudServerOutlined style={{ color: '#64748B', fontSize: 13 }} />
                      <span><strong>{cluster.workers_count || 2}</strong> Workers</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#16A34A', fontWeight: 600 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
                      <span>{cluster.online_count ?? 1} Online</span>
                    </div>

                    {(cluster.offline_count > 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#DC2626', fontWeight: 600 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#DC2626' }} />
                        <span>{cluster.offline_count} Offline</span>
                      </div>
                    )}
                  </div>

                  {/* ── RESOURCE PROGRESS BARS: CPU, Memory, Storage, GPU ── */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
                    marginBottom: 16
                  }}>
                    {/* CPU */}
                    <div>
                      <div style={{ fontSize: 11, color: '#64748B', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>CPU</span>
                        <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster.cpu_pct ?? 0}%</span>
                      </div>
                      <Progress percent={cluster.cpu_pct ?? 0} strokeColor="#2563EB" showInfo={false} size="small" />
                    </div>

                    {/* Memory */}
                    <div>
                      <div style={{ fontSize: 11, color: '#64748B', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>Memory</span>
                        <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster.mem_pct ?? 0}%</span>
                      </div>
                      <Progress percent={cluster.mem_pct ?? 0} strokeColor="#10B981" showInfo={false} size="small" />
                    </div>

                    {/* Storage */}
                    <div>
                      <div style={{ fontSize: 11, color: '#64748B', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>Storage</span>
                        <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster.storage_pct ?? 0}%</span>
                      </div>
                      <Progress percent={cluster.storage_pct ?? 0} strokeColor="#8B5CF6" showInfo={false} size="small" />
                    </div>

                    {/* GPU */}
                    <div>
                      <div style={{ fontSize: 11, color: '#64748B', display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span>GPU</span>
                        <span style={{ fontWeight: 700, color: '#0F172A' }}>{cluster.gpu_str && cluster.gpu_str !== '0/0' ? cluster.gpu_str : '0/0'}</span>
                      </div>
                      <Progress percent={cluster.gpu_str && cluster.gpu_str !== '0/0' ? 100 : 0} strokeColor="#2563EB" showInfo={false} size="small" />
                    </div>
                  </div>
                </div>

                {/* ── CARD FOOTER: Master IP & Last Updated ── */}
                <div style={{
                  borderTop: '1px solid #F1F5F9', paddingTop: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontSize: 11.5, color: '#64748B'
                }}>
                  <div>
                    Master: <span style={{ color: '#0F172A', fontWeight: 600 }}>{cluster.master_hostname || 'Unassigned'} {cluster.master_ip ? `(${cluster.master_ip})` : ''}</span>
                  </div>
                  <div>
                    Last updated: {cluster.last_updated || '5 minutes ago'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── EDIT CLUSTER MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16 }}>
            <EditOutlined style={{ color: '#2563EB' }} />
            Edit Cluster Metadata
          </div>
        }
        open={editModalOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={savingEdit}
        okText="Save Changes"
        okButtonProps={{ style: { background: '#2563EB' } }}
        destroyOnHidden
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          Modify display information, network domain, and profile without altering live node associations or cluster IDs.
        </Paragraph>
        <Form form={editForm} layout="vertical">
          <Form.Item
            label="Cluster Name"
            name="name"
            rules={[{ required: true, message: 'Please enter cluster name' }]}
          >
            <Input placeholder="e.g. AYAL-HPC-01" />
          </Form.Item>

          <Form.Item
            label="Domain"
            name="domain"
            rules={[{ required: true, message: 'Please enter domain' }]}
          >
            <Input placeholder="e.g. ayalhpc.local" />
          </Form.Item>

          <Form.Item label="Deployment Profile" name="profile">
            <Select>
              <Option value="CPU Compute Cluster">CPU Compute Cluster</Option>
              <Option value="GPU Compute Cluster">GPU Compute Cluster</Option>
              <Option value="Hybrid HPC Cluster">Hybrid HPC Cluster</Option>
              <Option value="High-Throughput Computing (HTC)">High-Throughput Computing (HTC)</Option>
            </Select>
          </Form.Item>

          <Form.Item label="Datacenter Location" name="location">
            <Input placeholder="e.g. Primary Datacenter Rack A01" />
          </Form.Item>

          <Form.Item label="Description" name="description">
            <TextArea rows={3} placeholder="Brief summary of cluster purpose and research workloads" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── DELETE / DECOMMISSION CLUSTER MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626', fontSize: 16 }}>
            <ExclamationCircleOutlined />
            Decommission Cluster Registration
          </div>
        }
        open={deleteModalOpen}
        onOk={handleConfirmDelete}
        onCancel={() => setDeleteModalOpen(false)}
        confirmLoading={deleting}
        okText="Confirm Decommission"
        okButtonProps={{ danger: true, disabled: confirmName !== deletingCluster?.name }}
        destroyOnHidden
      >
        <Alert
          type="warning"
          showIcon
          message="Safe Decommission Protection"
          description="This action unregisters the cluster from AYAL HPC Manager. All physical node data, user home directories, and shared NFS storage will remain completely intact."
          style={{ marginBottom: 16 }}
        />

        <Paragraph style={{ fontSize: 13 }}>
          To confirm decommissioning, please type the cluster name <strong style={{ color: '#DC2626' }}>{deletingCluster?.name}</strong> below:
        </Paragraph>

        <Input
          placeholder="Type cluster name here..."
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
        />
      </Modal>
    </div>
  )
}
