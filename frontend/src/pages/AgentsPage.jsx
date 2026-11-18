import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Table, Tag, Button, Input, Space, Modal, Drawer,
  Badge, Tooltip, message, Popconfirm, Form, Select, Alert,
  Typography, Row, Col, Dropdown, Menu
} from 'antd'
import {
  ApiOutlined,
  ReloadOutlined,
  PlusOutlined,
  SearchOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  CopyOutlined,
  DesktopOutlined,
  CloudServerOutlined,
  SlidersOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  DownOutlined,
  MoreOutlined
} from '@ant-design/icons'
import api from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function AgentsPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [agents, setAgents] = useState([])
  const [filteredAgents, setFilteredAgents] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    online: 0,
    offline: 0,
    unreachable: 0,
    connecting: 0
  })

  // Filters & Search
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [clusterFilter, setClusterFilter] = useState('ALL')
  const [clustersList, setClustersList] = useState([])

  // Selection
  const [selectedRowKeys, setSelectedRowKeys] = useState([])

  // Install Modal
  const [installModalOpen, setInstallModalOpen] = useState(false)
  const [installForm] = Form.useForm()
  const [installing, setInstalling] = useState(false)
  const [installResult, setInstallResult] = useState(null)

  // Logs Drawer
  const [logsDrawerOpen, setLogsDrawerOpen] = useState(false)
  const [activeLogNode, setActiveLogNode] = useState(null)
  const [logLines, setLogLines] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)

  // Action Loading map: { [nodeId_action]: boolean }
  const [actionLoading, setActionLoading] = useState({})

  // Auto-refresh interval (every 5 seconds)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    fetchAgentFleet(true)
  }, [])

  useEffect(() => {
    let timer = null
    if (autoRefresh) {
      timer = setInterval(() => {
        fetchAgentFleet(false)
      }, 5000)
    }
    return () => {
      if (timer) clearInterval(timer)
    }
  }, [autoRefresh])

  const fetchAgentFleet = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    try {
      const res = await api.get('/agents')
      const items = res.data?.agents || res.data?.items || []
      setAgents(items)
      setSummary({
        total: res.data?.total_nodes ?? items.length,
        online: res.data?.online_nodes ?? items.filter(a => a.agent_status === 'Online').length,
        offline: res.data?.offline_nodes ?? items.filter(a => a.agent_status === 'Offline' || a.agent_status === 'Unregistered').length,
        unreachable: res.data?.unreachable_nodes ?? items.filter(a => a.agent_status === 'Unreachable').length,
        connecting: items.filter(a => a.agent_status === 'Connecting' || a.agent_status === 'Installing').length,
      })

      // Extract unique clusters
      const cList = Array.from(new Set(items.map(a => a.cluster_name).filter(Boolean)))
      setClustersList(cList)
    } catch (err) {
      console.error('Failed to fetch agent inventory:', err)
      // Attempt fallback to /nodes if /agents is warming up
      try {
        const nRes = await api.get('/nodes')
        const nList = Array.isArray(nRes.data) ? nRes.data : (nRes.data?.nodes || [])
        const mapped = nList.map(n => ({
          node_id: n.id,
          node_name: n.hostname,
          cluster_id: n.cluster_id,
          cluster_name: 'myhpc',
          node_role: n.node_type || 'compute',
          ip_address: n.address,
          operating_system: 'AlmaLinux 9 (x86_64)',
          agent_version: '1.0.0',
          agent_status: n.state === 'online' ? 'Online' : (n.state === 'degraded' ? 'Connecting' : 'Offline'),
          ssh_status: n.tags?.connection_status === 'connected' ? 'Connected' : 'Failed',
          cpu: `${n.cpus || 16} Cores`,
          ram: `${n.memory_gb || 17.4} GB`,
          storage: `${n.disk_total_gb || 500} GB`,
          gpu: n.gpus ? `${n.gpus}x GPU` : 'None Detected',
          last_heartbeat: n.last_seen ? new Date(n.last_seen).toLocaleString() : 'Never',
          last_collection: n.last_seen ? new Date(n.last_seen).toLocaleString() : 'Pending',
        }))
        setAgents(mapped)
        setSummary({
          total: mapped.length,
          online: mapped.filter(a => a.agent_status === 'Online').length,
          offline: mapped.filter(a => a.agent_status === 'Offline').length,
          unreachable: 0,
          connecting: mapped.filter(a => a.agent_status === 'Connecting').length,
        })
      } catch (e) {
        message.error('Failed to communicate with Agent Inventory Service')
      }
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  // Filter application
  useEffect(() => {
    let list = [...agents]

    if (searchText.trim()) {
      const q = searchText.toLowerCase()
      list = list.filter(a =>
        (a.node_name || '').toLowerCase().includes(q) ||
        (a.ip_address || '').toLowerCase().includes(q) ||
        (a.node_id || '').toLowerCase().includes(q) ||
        (a.cluster_name || '').toLowerCase().includes(q)
      )
    }

    if (statusFilter !== 'ALL') {
      list = list.filter(a => (a.agent_status || '').toUpperCase() === statusFilter.toUpperCase())
    }

    if (clusterFilter !== 'ALL') {
      list = list.filter(a => a.cluster_name === clusterFilter)
    }

    setFilteredAgents(list)
  }, [agents, searchText, statusFilter, clusterFilter])

  // Single Agent Actions
  const handleAgentAction = async (nodeId, action) => {
    const key = `${nodeId}_${action}`
    setActionLoading(prev => ({ ...prev, [key]: true }))
    try {
      const res = await api.post(`/agents/${nodeId}/${action}`)
      message.success(res.data?.message || `Action '${action}' executed successfully on node`)
      fetchAgentFleet(false)
    } catch (err) {
      message.error(err.response?.data?.detail || `Failed to execute ${action} on node`)
    } finally {
      setActionLoading(prev => ({ ...prev, [key]: false }))
    }
  }

  // View Logs Drawer
  const handleOpenLogs = async (record) => {
    setActiveLogNode(record)
    setLogsDrawerOpen(true)
    setLogsLoading(true)
    try {
      const res = await api.get(`/agents/${record.node_id}/logs`, { params: { lines: 150 } })
      setLogLines(res.data?.log_lines || [])
    } catch (err) {
      setLogLines([
        `[${new Date().toISOString()}] Unable to retrieve live journalctl logs.`,
        `[${new Date().toISOString()}] Agent socket unreachable or node offline.`
      ])
    } finally {
      setLogsLoading(false)
    }
  }

  // Remove / Unregister Agent
  const handleUnregisterAgent = async (nodeId, hostname) => {
    try {
      await api.post(`/agents/${nodeId}/unregister`)
      message.success(`Agent registration removed for ${hostname}`)
      fetchAgentFleet(false)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to unregister agent')
    }
  }

  // Install Agent Submit
  const handleInstallSubmit = async (values) => {
    setInstalling(true)
    try {
      const targetId = values.node_id
      const res = await api.post(`/agents/${targetId}/install`, {
        ssh_user: values.ssh_user || 'root',
        ssh_password: values.ssh_password,
        ssh_port: values.ssh_port || 22,
      })
      setInstallResult(res.data)
      message.success('Agent deployment routine initiated')
      fetchAgentFleet(false)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Agent installation command failed')
    } finally {
      setInstalling(false)
    }
  }

  // Status Badge Renderer
  const renderAgentStatus = (status) => {
    const s = (status || '').toLowerCase()
    if (s === 'online') {
      return (
        <Tag color="success" style={{ borderRadius: 12, fontWeight: 700, padding: '2px 10px' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#52c41a', marginRight: 6 }} />
          Online
        </Tag>
      )
    }
    if (s === 'connecting' || s === 'updating') {
      return (
        <Tag color="processing" style={{ borderRadius: 12, fontWeight: 600, padding: '2px 10px' }}>
          <SyncOutlined spin style={{ marginRight: 6 }} />
          {status}
        </Tag>
      )
    }
    if (s === 'installing') {
      return (
        <Tag color="warning" style={{ borderRadius: 12, fontWeight: 600, padding: '2px 10px' }}>
          <SyncOutlined spin style={{ marginRight: 6 }} />
          Installing
        </Tag>
      )
    }
    if (s === 'unreachable') {
      return (
        <Tag color="warning" style={{ borderRadius: 12, fontWeight: 700, padding: '2px 10px' }}>
          <ExclamationCircleOutlined style={{ marginRight: 6 }} />
          Unreachable
        </Tag>
      )
    }
    if (s === 'installation failed') {
      return (
        <Tag color="error" style={{ borderRadius: 12, fontWeight: 700, padding: '2px 10px' }}>
          <CloseCircleOutlined style={{ marginRight: 6 }} />
          Install Failed
        </Tag>
      )
    }
    return (
      <Tag color="default" style={{ borderRadius: 12, fontWeight: 600, padding: '2px 10px', color: '#64748B' }}>
        <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#94A3B8', marginRight: 6 }} />
        {status || 'Offline'}
      </Tag>
    )
  }

  const renderSshStatus = (status) => {
    const s = (status || '').toLowerCase()
    if (s === 'connected' || s === 'active') {
      return <Tag color="cyan" style={{ borderRadius: 8, fontSize: 11, fontWeight: 600 }}>SSH OK</Tag>
    }
    return <Tag color="volcano" style={{ borderRadius: 8, fontSize: 11, fontWeight: 600 }}>SSH Failed</Tag>
  }

  // 16 Columns Configuration
  const columns = [
    {
      title: 'Node Name',
      dataIndex: 'node_name',
      key: 'node_name',
      fixed: 'left',
      width: 170,
      render: (name, record) => (
        <div>
          <div
            onClick={() => navigate(`/agents/${record.node_id}`)}
            style={{ fontWeight: 700, color: '#2563EB', cursor: 'pointer', fontSize: 13 }}
          >
            {name}
          </div>
          <Text type="secondary" style={{ fontSize: 11 }}>{record.ip_address}</Text>
        </div>
      ),
    },
    {
      title: 'Node ID',
      dataIndex: 'node_id',
      key: 'node_id',
      width: 120,
      render: (id) => (
        <Tooltip title={id}>
          <Space size={4}>
            <Text code style={{ fontSize: 11 }}>
              {id ? id.substring(0, 8) + '...' : '-'}
            </Text>
            <CopyOutlined
              style={{ cursor: 'pointer', fontSize: 11, color: '#64748B' }}
              onClick={() => { navigator.clipboard.writeText(id); message.success('Node ID copied'); }}
            />
          </Space>
        </Tooltip>
      ),
    },
    {
      title: 'Cluster',
      dataIndex: 'cluster_name',
      key: 'cluster_name',
      width: 110,
      render: (c) => <Tag color="geekblue" style={{ borderRadius: 6, fontWeight: 600 }}>{c || 'Unassigned'}</Tag>,
    },
    {
      title: 'Node Role',
      dataIndex: 'node_role',
      key: 'node_role',
      width: 100,
      render: (role) => {
        const r = (role || '').toLowerCase()
        const color = r === 'master' ? 'purple' : (r === 'gpu' ? 'gold' : 'blue')
        return <Tag color={color} style={{ borderRadius: 6, fontWeight: 700, textTransform: 'capitalize' }}>{role}</Tag>
      },
    },
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      key: 'ip_address',
      width: 125,
      render: (ip) => <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>{ip}</Text>,
    },
    {
      title: 'Operating System',
      dataIndex: 'operating_system',
      key: 'operating_system',
      width: 160,
      ellipsis: true,
      render: (os) => <Text style={{ fontSize: 12 }}>{os || 'Linux (x86_64)'}</Text>,
    },
    {
      title: 'Agent Version',
      dataIndex: 'agent_version',
      key: 'agent_version',
      width: 110,
      render: (v) => <Tag style={{ borderRadius: 6, fontSize: 11 }}>{v ? `v${v}` : 'None'}</Tag>,
    },
    {
      title: 'Agent Status',
      dataIndex: 'agent_status',
      key: 'agent_status',
      width: 130,
      render: (st) => renderAgentStatus(st),
    },
    {
      title: 'SSH Status',
      dataIndex: 'ssh_status',
      key: 'ssh_status',
      width: 110,
      render: (ssh) => renderSshStatus(ssh),
    },
    {
      title: 'CPU',
      dataIndex: 'cpu',
      key: 'cpu',
      width: 140,
      render: (cpu) => <Text style={{ fontSize: 12, fontWeight: 600 }}>{cpu}</Text>,
    },
    {
      title: 'RAM',
      dataIndex: 'ram',
      key: 'ram',
      width: 100,
      render: (ram) => <Text style={{ fontSize: 12 }}>{ram}</Text>,
    },
    {
      title: 'Storage',
      dataIndex: 'storage',
      key: 'storage',
      width: 100,
      render: (stor) => <Text style={{ fontSize: 12 }}>{stor}</Text>,
    },
    {
      title: 'GPU',
      dataIndex: 'gpu',
      key: 'gpu',
      width: 130,
      ellipsis: true,
      render: (gpu) => <Text style={{ fontSize: 12 }}>{gpu}</Text>,
    },
    {
      title: 'Last Heartbeat',
      dataIndex: 'last_heartbeat',
      key: 'last_heartbeat',
      width: 150,
      render: (hb) => <Text type="secondary" style={{ fontSize: 11 }}>{hb}</Text>,
    },
    {
      title: 'Last Collection',
      dataIndex: 'last_collection',
      key: 'last_collection',
      width: 150,
      render: (col) => <Text type="secondary" style={{ fontSize: 11 }}>{col}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      fixed: 'right',
      width: 220,
      render: (_, record) => {
        const moreItems = [
          {
            key: 'restart',
            label: 'Restart Agent',
            icon: <SyncOutlined />,
            onClick: () => handleAgentAction(record.node_id, 'restart'),
          },
          {
            key: 'stop',
            label: 'Stop Agent',
            icon: <PauseCircleOutlined />,
            onClick: () => handleAgentAction(record.node_id, 'stop'),
          },
          {
            key: 'start',
            label: 'Start Agent',
            icon: <PlayCircleOutlined />,
            onClick: () => handleAgentAction(record.node_id, 'start'),
          },
          {
            key: 'logs',
            label: 'View Agent Logs',
            icon: <FileTextOutlined />,
            onClick: () => handleOpenLogs(record),
          },
          { type: 'divider' },
          {
            key: 'unregister',
            label: 'Remove Registration',
            danger: true,
            icon: <DeleteOutlined />,
            onClick: () => handleUnregisterAgent(record.node_id, record.node_name),
          },
        ]

        return (
          <Space size={4}>
            <Tooltip title="Inspect Live Hardware & OS Inventory">
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => navigate(`/agents/${record.node_id}`)}
                style={{ fontSize: 12, borderRadius: 6 }}
              >
                View
              </Button>
            </Tooltip>

            <Tooltip title="Collect Live Telemetry Now">
              <Button
                size="small"
                icon={<ReloadOutlined spin={actionLoading[`${record.node_id}_collect`]} />}
                onClick={() => handleAgentAction(record.node_id, 'collect')}
                style={{ borderRadius: 6 }}
              />
            </Tooltip>

            <Tooltip title="Reinstall Agent Daemon via SSH">
              <Button
                size="small"
                loading={actionLoading[`${record.node_id}_reinstall`]}
                onClick={() => handleAgentAction(record.node_id, 'reinstall')}
                style={{ borderRadius: 6 }}
              >
                Reinstall
              </Button>
            </Tooltip>

            <Dropdown menu={{ items: moreItems }} placement="bottomRight" trigger={['click']}>
              <Button size="small" icon={<MoreOutlined />} style={{ borderRadius: 6 }} />
            </Dropdown>
          </Space>
        )
      },
    },
  ]

  return (
    <div style={{ maxWidth: 1650, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── TOP BREADCRUMB & CONTROLS ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#64748B' }}>
          <ApiOutlined style={{ fontSize: 18, color: '#2563EB' }} />
          <span>Infrastructure</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A', fontSize: 14 }}>Agents Management</span>
        </div>

        <Space>
          <Button
            icon={<ReloadOutlined spin={loading} />}
            onClick={() => fetchAgentFleet(true)}
            style={{ borderRadius: 6 }}
          >
            Refresh Fleet
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              installForm.resetFields()
              setInstallResult(null)
              setInstallModalOpen(true)
            }}
            style={{ background: '#2563EB', borderRadius: 6 }}
          >
            Install Agent
          </Button>
        </Space>
      </div>

      {/* ── FLEET KPI CARDS ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6} md={4} lg={4}>
          <Card bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>TOTAL AGENTS</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginTop: 4 }}>
              {summary.total}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>Enrolled nodes</div>
          </Card>
        </Col>

        <Col xs={12} sm={6} md={5} lg={5}>
          <Card bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 8, border: '1px solid #BBF7D0', background: '#F0FDF4' }}>
            <div style={{ fontSize: 12, color: '#16A34A', fontWeight: 700 }}>ONLINE AGENTS</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#15803D', marginTop: 4 }}>
              {summary.online}
            </div>
            <div style={{ fontSize: 11, color: '#16A34A', marginTop: 2 }}>Active Heartbeats (&le; 45s)</div>
          </Card>
        </Col>

        <Col xs={12} sm={6} md={5} lg={5}>
          <Card bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 8, border: '1px solid #FED7AA', background: '#FFFBEB' }}>
            <div style={{ fontSize: 12, color: '#D97706', fontWeight: 700 }}>CONNECTING / INSTALLING</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#B45309', marginTop: 4 }}>
              {summary.connecting}
            </div>
            <div style={{ fontSize: 11, color: '#D97706', marginTop: 2 }}>Pending initialization</div>
          </Card>
        </Col>

        <Col xs={12} sm={6} md={5} lg={5}>
          <Card bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 8, border: '1px solid #FEE2E2', background: '#FEF2F2' }}>
            <div style={{ fontSize: 12, color: '#DC2626', fontWeight: 700 }}>OFFLINE / UNREACHABLE</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#B91C1C', marginTop: 4 }}>
              {summary.offline + summary.unreachable}
            </div>
            <div style={{ fontSize: 11, color: '#DC2626', marginTop: 2 }}>Action required</div>
          </Card>
        </Col>

        <Col xs={24} sm={12} md={5} lg={5}>
          <Card bodyStyle={{ padding: '14px 16px' }} style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>COLLECTION ENGINE</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#2563EB', marginTop: 8 }}>
              AYAL Daemon v1.0.0
            </div>
            <div style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>Interval: 30s | Push & Pull</div>
          </Card>
        </Col>
      </Row>

      {/* ── FILTER & SEARCH BAR ── */}
      <Card
        bodyStyle={{ padding: '14px 18px' }}
        style={{ borderRadius: 8, marginBottom: 16, border: '1px solid #E2E8F0' }}
      >
        <Row gutter={[12, 12]} align="middle" justify="space-between">
          <Col xs={24} sm={12} md={8}>
            <Input
              prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
              placeholder="Search by Hostname, IP, or Node ID..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              allowClear
              style={{ borderRadius: 6 }}
            />
          </Col>

          <Col xs={24} sm={12} md={12}>
            <Space wrap>
              <span>Status:</span>
              <Select
                value={statusFilter}
                onChange={setStatusFilter}
                style={{ width: 140 }}
              >
                <Option value="ALL">All Statuses</Option>
                <Option value="ONLINE">Online</Option>
                <Option value="CONNECTING">Connecting</Option>
                <Option value="INSTALLING">Installing</Option>
                <Option value="OFFLINE">Offline</Option>
                <Option value="UNREACHABLE">Unreachable</Option>
              </Select>

              <span>Cluster:</span>
              <Select
                value={clusterFilter}
                onChange={setClusterFilter}
                style={{ width: 140 }}
              >
                <Option value="ALL">All Clusters</Option>
                {clustersList.map(c => (
                  <Option key={c} value={c}>{c}</Option>
                ))}
              </Select>

              {selectedRowKeys.length > 0 && (
                <Popconfirm
                  title={`Collect telemetry from ${selectedRowKeys.length} nodes?`}
                  onConfirm={async () => {
                    for (const id of selectedRowKeys) {
                      await handleAgentAction(id, 'collect')
                    }
                    message.success(`Batch collection completed for ${selectedRowKeys.length} nodes`)
                  }}
                >
                  <Button size="small" type="primary" ghost style={{ borderRadius: 6 }}>
                    Collect Selected ({selectedRowKeys.length})
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ── AGENT INVENTORY TABLE (16 Columns) ── */}
      <Card
        bodyStyle={{ padding: 0 }}
        style={{ borderRadius: 8, border: '1px solid #E2E8F0', overflow: 'hidden' }}
      >
        <Table
          rowKey="node_id"
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
          }}
          columns={columns}
          dataSource={filteredAgents}
          loading={loading}
          pagination={{ pageSize: 12, showSizeChanger: true }}
          scroll={{ x: 2300 }}
          size="middle"
        />
      </Card>

      {/* ── INSTALL AGENT MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ApiOutlined style={{ color: '#2563EB' }} />
            Install AYAL Monitoring Agent
          </div>
        }
        open={installModalOpen}
        onCancel={() => { setInstallModalOpen(false); setInstallResult(null); }}
        footer={null}
        width={650}
        destroyOnHidden
      >
        <Alert
          type="info"
          showIcon
          message="Automated Agent Deployment"
          description="AYAL HPC Agent runs as a lightweight daemon (ayalhpc-agent.service) on Linux nodes. It continuously reports hardware metrics, storage health, GPU status, and HPC service daemons."
          style={{ marginBottom: 16 }}
        />

        <Form
          form={installForm}
          layout="vertical"
          onFinish={handleInstallSubmit}
          initialValues={{ ssh_user: 'root', ssh_port: 22 }}
        >
          <Form.Item
            name="node_id"
            label="Target Registered Node"
            rules={[{ required: true, message: 'Please select target node' }]}
          >
            <Select placeholder="Select node to deploy agent onto">
              {agents.map(n => (
                <Option key={n.node_id} value={n.node_id}>
                  {n.node_name} ({n.ip_address}) - Current: {n.agent_status}
                </Option>
              ))}
            </Select>
          </Form.Item>

          <Row gutter={12}>
            <Col span={14}>
              <Form.Item name="ssh_user" label="SSH Username" rules={[{ required: true }]}>
                <Input placeholder="root or sudo user" />
              </Form.Item>
            </Col>
            <Col span={10}>
              <Form.Item name="ssh_port" label="SSH Port">
                <Input type="number" placeholder="22" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="ssh_password" label="SSH Password (or configured private key)">
            <Input.Password placeholder="Enter root or sudo password for initial agent setup" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 10 }}>
            <Button onClick={() => setInstallModalOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={installing} style={{ background: '#2563EB' }}>
              Deploy Agent
            </Button>
          </div>
        </Form>

        {installResult && (
          <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #E2E8F0' }}>
            <Alert
              type="success"
              showIcon
              message={installResult.message}
              description={
                <div style={{ marginTop: 8 }}>
                  <Text strong>Or run manual one-liner on target node:</Text>
                  <Paragraph
                    copyable
                    code
                    style={{ background: '#0F172A', color: '#38BDF8', padding: '8px 12px', borderRadius: 6, marginTop: 6 }}
                  >
                    {installResult.curl_command}
                  </Paragraph>
                </div>
              }
            />
          </div>
        )}
      </Modal>

      {/* ── AGENT LOGS DRAWER ── */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#2563EB' }} />
            <span>Agent Service Logs: <strong style={{ color: '#0F172A' }}>{activeLogNode?.node_name}</strong></span>
          </div>
        }
        placement="right"
        width={720}
        open={logsDrawerOpen}
        onClose={() => setLogsDrawerOpen(false)}
        extra={
          <Button
            size="small"
            icon={<ReloadOutlined spin={logsLoading} />}
            onClick={() => handleOpenLogs(activeLogNode)}
          >
            Refresh Logs
          </Button>
        }
      >
        <div style={{
          background: '#0F172A',
          color: '#E2E8F0',
          fontFamily: 'monospace',
          fontSize: 12,
          padding: 16,
          borderRadius: 8,
          minHeight: 500,
          maxHeight: 'calc(100vh - 160px)',
          overflowY: 'auto'
        }}>
          {logLines.length === 0 ? (
            <div style={{ color: '#64748B' }}>No recent log lines recorded.</div>
          ) : (
            logLines.map((line, idx) => (
              <div key={idx} style={{ lineHeight: '1.6', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                {line}
              </div>
            ))
          )}
        </div>
      </Drawer>
    </div>
  )
}
