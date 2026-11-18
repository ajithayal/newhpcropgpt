import React, { useState, useEffect } from 'react'
import {
  Card, Table, Tag, Button, Typography, Space, Row, Col,
  Badge, Modal, Alert, Tooltip, message, Popconfirm, Select
} from 'antd'
import {
  SyncOutlined, CheckCircleOutlined, ClockCircleOutlined,
  CloseCircleOutlined, ExclamationCircleOutlined, ReloadOutlined,
  DesktopOutlined, CloudServerOutlined, StopOutlined, FileTextOutlined
} from '@ant-design/icons'
import api from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function OperationsPage() {
  const [operations, setOperations] = useState([])
  const [targetsHealth, setTargetsHealth] = useState([])
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')

  // Detailed modal state
  const [selectedOp, setSelectedOp] = useState(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [opsRes, healthRes] = await Promise.all([
        api.get('/operations', { params: statusFilter !== 'all' ? { status: statusFilter } : {} }),
        api.get('/operations/health'),
      ])
      setOperations(opsRes.data || [])
      setTargetsHealth(healthRes.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 5000)
    return () => clearInterval(timer)
  }, [statusFilter])

  const handleRetry = async (opId) => {
    try {
      await api.post(`/operations/${opId}/retry`)
      message.success('Operation scheduled for immediate retry')
      loadData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to retry operation')
    }
  }

  const handleCancel = async (opId) => {
    try {
      await api.post(`/operations/${opId}/cancel`)
      message.success('Operation cancelled')
      loadData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to cancel operation')
    }
  }

  const handleViewLogs = async (op) => {
    setLoadingDetail(true)
    setModalOpen(true)
    try {
      const res = await api.get(`/operations/${op.id}`)
      setSelectedOp(res.data)
    } catch (err) {
      setSelectedOp(op)
    } finally {
      setLoadingDetail(false)
    }
  }

  const renderTargetChip = (target) => {
    const st = (target.status || '').toLowerCase()
    if (st === 'applied') {
      return (
        <Tooltip key={target.id || target.host} title={`Applied at ${target.applied_at || 'now'}`}>
          <Tag color="success" icon={<CheckCircleOutlined />}>
            {target.host}: Applied
          </Tag>
        </Tooltip>
      )
    } else if (st === 'pending' || st === 'skipped_offline') {
      return (
        <Tooltip key={target.id || target.host} title={target.last_error || 'Target node is offline. Will apply on reconnect.'}>
          <Tag color="warning" icon={<ClockCircleOutlined />}>
            {target.host}: Pending (Offline)
          </Tag>
        </Tooltip>
      )
    } else if (st === 'applying') {
      return (
        <Tag key={target.id || target.host} color="processing" icon={<SyncOutlined spin />}>
          {target.host}: Applying (Attempt {target.attempts})
        </Tag>
      )
    } else {
      return (
        <Tooltip key={target.id || target.host} title={target.last_error || 'Execution failed'}>
          <Tag color="error" icon={<CloseCircleOutlined />}>
            {target.host}: Failed
          </Tag>
        </Tooltip>
      )
    }
  }

  const columns = [
    {
      title: 'Operation Type',
      dataIndex: 'type',
      key: 'type',
      render: (t, r) => (
        <div>
          <Text strong style={{ fontSize: 13, textTransform: 'capitalize' }}>
            {t.replace(/_/g, ' ')}
          </Text>
          <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
            ID: {r.id.slice(0, 8)}...
          </div>
        </div>
      ),
    },
    {
      title: 'Target Status Breakdown',
      key: 'targets',
      render: (_, r) => (
        <Space wrap>
          {(r.targets || []).map(renderTargetChip)}
        </Space>
      ),
    },
    {
      title: 'Overall State',
      dataIndex: 'status',
      key: 'status',
      width: 130,
      render: (s) => {
        if (s === 'applied') return <Tag color="green">APPLIED</Tag>
        if (s === 'pending') return <Tag color="gold">PENDING</Tag>
        if (s === 'applying') return <Tag color="blue">APPLYING</Tag>
        if (s === 'partial') return <Tag color="purple">PARTIAL</Tag>
        return <Tag color="red">FAILED</Tag>
      },
    },
    {
      title: 'Created At',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (dt) => dt ? new Date(dt).toLocaleString() : '-',
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 190,
      render: (_, r) => (
        <Space>
          <Button size="small" icon={<FileTextOutlined />} onClick={() => handleViewLogs(r)}>
            Logs
          </Button>
          {(r.status === 'failed' || r.status === 'pending') && (
            <Button size="small" type="primary" ghost icon={<ReloadOutlined />} onClick={() => handleRetry(r.id)}>
              Retry
            </Button>
          )}
          {r.status === 'pending' && (
            <Popconfirm title="Cancel operation?" onConfirm={() => handleCancel(r.id)}>
              <Button size="small" danger icon={<StopOutlined />} />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 800, color: '#0F172A' }}>
            Operations & Offline-Safe Reconciliation
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Continuous desired state enforcement across cluster controller and compute nodes.
          </Text>
        </div>
        <Space>
          <Select value={statusFilter} onChange={setStatusFilter} style={{ width: 130 }}>
            <Option value="all">All States</Option>
            <Option value="pending">Pending</Option>
            <Option value="applied">Applied</Option>
            <Option value="failed">Failed</Option>
          </Select>
          <Button icon={<ReloadOutlined />} onClick={loadData} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>

      {/* ── LIVE CLUSTER HEALTH BANNER ── */}
      <Card
        title={
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            Cluster Node Target Connectivity (15s Health Probe)
          </span>
        }
        size="small"
        style={{ marginBottom: 16, border: '1px solid #E2E8F0', borderRadius: 8 }}
      >
        <Row gutter={[16, 12]}>
          {targetsHealth.map((th) => (
            <Col xs={24} sm={12} md={8} lg={6} key={th.id || th.host}>
              <div style={{
                padding: '10px 14px', borderRadius: 6,
                background: th.online ? '#F0FDF4' : '#FEF2F2',
                border: `1px solid ${th.online ? '#BBF7D0' : '#FECACA'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {th.role === 'master' ? <CloudServerOutlined style={{ color: '#2563EB' }} /> : <DesktopOutlined style={{ color: '#64748B' }} />}
                    <Text strong style={{ fontSize: 13 }}>{th.host}</Text>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                    Role: <Tag style={{ margin: 0, fontSize: 10 }}>{th.role.toUpperCase()}</Tag>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Badge status={th.online ? 'success' : 'error'} text={th.online ? 'ONLINE' : 'OFFLINE'} />
                  {th.online && th.latency_ms !== null && (
                    <div style={{ fontSize: 10, color: '#16A34A', fontWeight: 600 }}>
                      {th.latency_ms} ms
                    </div>
                  )}
                </div>
              </div>
            </Col>
          ))}
          {targetsHealth.length === 0 && (
            <Col span={24}>
              <Text type="secondary">
                {loading ? 'Probing node connectivity...' : 'No cluster nodes enrolled. Enrolled nodes will be monitored here.'}
              </Text>
            </Col>
          )}
        </Row>
      </Card>

      {/* ── OPERATIONS TABLE ── */}
      <Card variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
        <Table
          columns={columns}
          dataSource={operations}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 15 }}
        />
      </Card>

      {/* ── LOGS / DETAILS MODAL ── */}
      <Modal
        title={
          <Space>
            <FileTextOutlined style={{ color: '#2563EB' }} />
            <span>Operation Details & Node Execution Logs</span>
          </Space>
        }
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setModalOpen(false)}>
            Close
          </Button>,
          selectedOp && (selectedOp.status === 'failed' || selectedOp.status === 'pending') && (
            <Button key="retry" type="primary" onClick={() => { handleRetry(selectedOp.id); setModalOpen(false) }}>
              Retry Now
            </Button>
          ),
        ]}
        width={750}
      >
        {selectedOp && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong>Operation Type:</Text> <Tag>{selectedOp.type}</Tag>
              <Text strong style={{ marginLeft: 16 }}>Aggregate Status:</Text> <Tag color={selectedOp.status === 'applied' ? 'green' : 'orange'}>{selectedOp.status?.toUpperCase()}</Tag>
            </div>

            <Title level={5} style={{ marginBottom: 8 }}>Per-Target Execution Output:</Title>
            {(selectedOp.targets || []).map((t) => (
              <Card
                key={t.id || t.host}
                size="small"
                title={
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Target: <strong>{t.host}</strong> ({t.role})</span>
                    {renderTargetChip(t)}
                  </div>
                }
                style={{ marginBottom: 12, background: '#F8FAFC' }}
              >
                {t.last_error && (
                  <Alert message={t.last_error} type="error" showIcon style={{ marginBottom: 8 }} />
                )}
                <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4 }}>
                  Attempts: {t.attempts} | Last Attempt: {t.last_attempt_at ? new Date(t.last_attempt_at).toLocaleString() : 'Never'}
                </div>
                <pre style={{
                  background: '#0F172A', color: '#E2E8F0', padding: 10, borderRadius: 6,
                  maxHeight: 180, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', margin: 0
                }}>
                  {t.execution_log || 'No execution logs recorded yet. Operation may be pending host online.'}
                </pre>
              </Card>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
