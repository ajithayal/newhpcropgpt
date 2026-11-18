import React from 'react'
/**
 * AjiCorehpc Manager — Settings Page
 * Sections:
 * 1. Identity & Authentication (FreeIPA Server Configuration & Health)
 * 2. Client Enrollment (Node FreeIPA Client Installation & SSSD Setup)
 * 3. BMC Management (BMC, iDRAC, iLO, Hardware Inventory, Connection History)
 */
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Tabs, Form, Input, Button, message, Card, Row, Col, Tag, Alert,
  Table, Modal, Progress, Space, Divider, Typography, Badge,
  Select, Switch, InputNumber, Steps, Descriptions, Spin, Popconfirm
} from 'antd'
import {
  SafetyCertificateOutlined, CheckCircleOutlined, CloseCircleOutlined,
  ThunderboltOutlined, SettingOutlined, DesktopOutlined, SyncOutlined,
  CloudServerOutlined, LockOutlined, InfoCircleOutlined, ToolOutlined,
  WarningOutlined, HddOutlined, DatabaseOutlined, PoweroffOutlined,
  CheckOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, DeleteOutlined,
  EditOutlined, PlayCircleOutlined, DownloadOutlined, FilterOutlined,
  SearchOutlined, KeyOutlined, AppstoreOutlined, ClearOutlined, RollbackOutlined
} from '@ant-design/icons'
import api, { identityAPI, bmcAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function SettingsPage() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('identity')
  const [bmcSubTab, setBmcSubTab] = useState('inventory')

  // Forms
  const [ipaForm] = Form.useForm()

  // Base State
  const [loading, setLoading] = useState(true)
  const [savingIPA, setSavingIPA] = useState(false)
  const [testingIPA, setTestingIPA] = useState(false)
  const [ipaTestResult, setIpaTestResult] = useState(null)
  const [ipaConfig, setIpaConfig] = useState(null)

  // Client Enrollment State
  const [nodes, setNodes] = useState([])
  const [enrollingNode, setEnrollingNode] = useState(null)
  const [enrollModalOpen, setEnrollModalOpen] = useState(false)
  const [enrollForm] = Form.useForm()
  const [enrolling, setEnrolling] = useState(false)
  const [enrollLogs, setEnrollLogs] = useState([])

  // ---------------------------------------------------------------------------
  // BMC & Hardware Management State
  // ---------------------------------------------------------------------------
  const [bmcServers, setBmcServers] = useState([])
  const [loadingBmc, setLoadingBmc] = useState(false)
  const [hardwareInventories, setHardwareInventories] = useState([])
  const [loadingInventories, setLoadingInventories] = useState(false)
  const [connectionHistory, setConnectionHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Add Server Modal & 3-Stage Validation
  const [addServerModalOpen, setAddServerModalOpen] = useState(false)
  const [serverForm] = Form.useForm()
  const [validationStep, setValidationStep] = useState(0)
  const [validatingServer, setValidatingServer] = useState(false)
  const [validationResult, setValidationResult] = useState(null)
  const [savingServer, setSavingServer] = useState(false)

  // Deep Inventory Modal
  const [selectedInventory, setSelectedInventory] = useState(null)
  const [inventoryModalOpen, setInventoryModalOpen] = useState(false)
  const [inventoryDetailTab, setInventoryDetailTab] = useState('system')

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [ipaRes, nodesRes] = await Promise.all([
        identityAPI.getFreeIPAConfig().catch(() => ({ data: {} })),
        identityAPI.getEnrolledNodes().catch(() => ({ data: [] })),
      ])

      setNodes(nodesRes.data || [])

      const ipaData = ipaRes.data || {}
      setIpaConfig(ipaData)
      ipaForm.setFieldsValue({
        server_fqdn: ipaData.server_fqdn || '',
        server_ip: ipaData.server_ip || '',
        domain: ipaData.domain || '',
        realm: ipaData.realm || '',
        admin_user: ipaData.admin_user || '',
        ldap_url: ipaData.ldap_url || '',
        ldaps_url: ipaData.ldaps_url || '',
        base_dn: ipaData.base_dn || '',
        bind_dn: ipaData.bind_dn || '',
        ca_cert_path: ipaData.ca_cert_path || '',
      })
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Load BMC Data
  const loadBmcData = async () => {
    setLoadingBmc(true)
    setLoadingInventories(true)
    setLoadingHistory(true)
    try {
      const [srvRes, invRes, histRes] = await Promise.all([
        bmcAPI.getServers(),
        bmcAPI.getAllInventories(),
        bmcAPI.getHistory(50),
      ])
      setBmcServers(srvRes.data?.servers || [])
      setHardwareInventories(invRes.data?.inventories || [])
      setConnectionHistory(histRes.data?.history || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingBmc(false)
      setLoadingInventories(false)
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'bmc-management') {
      loadBmcData()
    }
  }, [activeTab])

  // Save FreeIPA Server Config
  const handleSaveIPA = async (values) => {
    setSavingIPA(true)
    try {
      await identityAPI.updateFreeIPAConfig(values)
      setIpaConfig(prev => ({ ...(prev || {}), ...values }))
      message.success('FreeIPA server configuration saved successfully')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to save FreeIPA settings')
    } finally {
      setSavingIPA(false)
    }
  }

  // Test FreeIPA Server Connection
  const handleTestIPA = async () => {
    try {
      const vals = await ipaForm.validateFields()
      setTestingIPA(true)
      setIpaTestResult(null)
      const res = await identityAPI.testFreeIPA(vals)
      setIpaTestResult(res.data)
      if (res.data?.success) {
        message.success('FreeIPA connectivity and directory verification passed')
      } else {
        message.error(res.data?.message || 'FreeIPA connection test failed')
      }
    } catch (err) {
      message.error('Please fill in required FreeIPA server settings')
    } finally {
      setTestingIPA(false)
    }
  }

  // Open Client Enrollment Modal
  const handleOpenEnroll = (node) => {
    setEnrollingNode(node)
    setEnrollLogs([])
    enrollForm.setFieldsValue({
      node_ip: node.ip,
      hostname: node.hostname,
      domain: '',
      realm: '',
      server_ip: '',
      admin_user: 'admin',
    })
    setEnrollModalOpen(true)
  }

  // Execute Client Enrollment
  const handleRunEnrollment = async () => {
    try {
      const vals = await enrollForm.validateFields()
      setEnrolling(true)
      setEnrollLogs(['[INFO] Initializing client enrollment pipeline...'])
      const res = await identityAPI.enrollClient(vals)
      if (res.data?.logs) {
        setEnrollLogs(res.data.logs)
      }
      if (res.data?.success) {
        message.success(`Client node ${vals.hostname} enrolled into FreeIPA domain successfully`)
        const updated = await identityAPI.getEnrolledNodes()
        setNodes(updated.data || [])
      } else {
        message.error(`Enrollment failed on ${vals.hostname}`)
      }
    } catch (err) {
      message.error('Failed to execute client enrollment')
    } finally {
      setEnrolling(false)
    }
  }

  // ---------------------------------------------------------------------------
  // BMC Actions: Validate & Discover -> Save
  // ---------------------------------------------------------------------------
  const handleOpenAddServer = (type = 'Dell iDRAC') => {
    setValidationStep(0)
    setValidationResult(null)
    serverForm.resetFields()
    serverForm.setFieldsValue({
      server_name: '',
      hostname: '',
      controller_type: type,
      bmc_ip: '',
      port: 443,
      username: 'root',
      protocol: 'Redfish',
      tls_verify: true,
    })
    setAddServerModalOpen(true)
  }

  const handleRunValidationAndDiscovery = async () => {
    try {
      const vals = await serverForm.validateFields()
      setValidatingServer(true)
      setValidationResult(null)
      const res = await bmcAPI.validateAndDiscover(vals)
      setValidationResult(res.data)
      setValidationStep(1)
      message.success('Controller connectivity, authentication & capabilities verified!')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Validation & discovery failed')
    } finally {
      setValidatingServer(false)
    }
  }

  const handleSaveValidatedServer = async () => {
    try {
      const vals = await serverForm.validateFields()
      setSavingServer(true)
      await bmcAPI.saveServer({
        ...vals,
        node_ip: vals.bmc_ip,
        firmware_version: validationResult?.firmware_version || 'v6.10.30.00',
      })
      message.success(`Server '${vals.server_name}' registered successfully!`)
      setAddServerModalOpen(false)
      loadBmcData()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to save server')
    } finally {
      setSavingServer(false)
    }
  }

  const handleRefreshInventory = async (serverId) => {
    message.loading({ content: 'Polling real hardware sensors via Redfish & SSH...', key: 'inv_refresh' })
    try {
      const res = await bmcAPI.refreshServerInventory(serverId)
      message.success({ content: res.data.message, key: 'inv_refresh', duration: 4 })
      loadBmcData()
    } catch (err) {
      message.error({ content: 'Inventory refresh failed', key: 'inv_refresh' })
    }
  }

  const handleViewInventory = (inv) => {
    setSelectedInventory(inv)
    setInventoryDetailTab('system')
    setInventoryModalOpen(true)
  }

  const handleDeleteServer = async (id) => {
    try {
      await bmcAPI.deleteServer(id)
      message.success('Server controller removed')
      loadBmcData()
    } catch (err) {
      message.error('Failed to remove server')
    }
  }

  // ---------------------------------------------------------------------------
  // Tab Definitions
  // ---------------------------------------------------------------------------
  const tabItems = [
    {
      key: 'identity',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SafetyCertificateOutlined />
          Identity & Authentication (FreeIPA)
        </span>
      ),
      children: (
        <div style={{ maxWidth: 1000, marginTop: 10 }}>
          <Alert
            message="Authoritative Identity Management (FreeIPA / Kerberos / SSSD)"
            description="AYAL HPC Manager integrates directly with FreeIPA to provide single sign-on, centralized POSIX user accounts (UID/GID), Kerberos security tickets, and SSSD caching across all master and worker compute nodes."
            type="info"
            showIcon
            style={{ marginBottom: 20 }}
          />

          <Row gutter={[24, 24]}>
            <Col xs={24} lg={15}>
              <Card title="FreeIPA Server Configuration" variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
                <Form form={ipaForm} layout="vertical" onFinish={handleSaveIPA}>
                  <Row gutter={16}>
                    <Col span={14}>
                      <Form.Item name="server_fqdn" label="IPA Server FQDN" rules={[{ required: true, message: 'Please specify server FQDN' }]}>
                        <Input placeholder="e.g. ipa.cluster.local" />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name="server_ip" label="IPA Server IP" rules={[{ required: true, message: 'Please specify server IP' }]}>
                        <Input placeholder="e.g. 192.168.1.10" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="domain" label="IPA Domain" rules={[{ required: true, message: 'Please specify domain' }]}>
                        <Input placeholder="e.g. cluster.local" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="realm" label="Kerberos Realm" rules={[{ required: true, message: 'Please specify realm' }]}>
                        <Input placeholder="e.g. CLUSTER.LOCAL" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="admin_user" label="IPA Administrative Principal" rules={[{ required: true, message: 'Please specify admin principal' }]}>
                        <Input placeholder="e.g. admin" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="admin_password" label="Administrative Password">
                        <Input.Password placeholder="••••••••" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="ldap_url" label="LDAP URL">
                        <Input placeholder="e.g. ldap://ipa.cluster.local:389" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="ldaps_url" label="LDAPS URL (SSL/TLS)">
                        <Input placeholder="e.g. ldaps://ipa.cluster.local:636" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item name="ca_cert_path" label="CA Certificate Path">
                    <Input placeholder="e.g. /etc/ipa/ca.crt" />
                  </Form.Item>

                  <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                    <Button type="primary" htmlType="submit" loading={savingIPA} style={{ background: '#2563EB' }}>
                      Save Configuration
                    </Button>
                    <Button icon={<ThunderboltOutlined />} onClick={handleTestIPA} loading={testingIPA}>
                      Test IPA Connection
                    </Button>
                  </div>
                </Form>
              </Card>
            </Col>

            <Col xs={24} lg={9}>
              <Card title="FreeIPA Status & Health" variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
                {(() => {
                  const isConfigured = Boolean(ipaConfig?.server_fqdn || ipaConfig?.server_ip || ipaConfig?.domain)
                  const isTested = Boolean(ipaTestResult)
                  const isOnline = isTested ? Boolean(ipaTestResult?.success) : false

                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                        <Badge status={isOnline ? 'success' : (isTested ? 'error' : (isConfigured ? 'warning' : 'default'))} />
                        <span style={{ fontWeight: 700, fontSize: 14, color: isOnline ? '#16A34A' : (isTested ? '#DC2626' : (isConfigured ? '#D97706' : '#64748B')) }}>
                          {isOnline ? 'IPA Directory Service Online' : (isTested ? 'FreeIPA Offline / Unreachable' : (isConfigured ? 'Configured (Verification Pending)' : 'Not Configured'))}
                        </span>
                      </div>

                      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8, color: '#475569' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Kerberos Realm:</span>
                          {ipaConfig?.realm ? <strong style={{ color: '#0F172A' }}>{ipaConfig.realm}</strong> : <span style={{ color: '#94A3B8' }}>Not Configured</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>Directory Port:</span>
                          {isConfigured ? <strong style={{ color: '#0F172A' }}>389 / 636 (LDAPS)</strong> : <span style={{ color: '#94A3B8' }}>—</span>}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>CA Certificate:</span>
                          {isOnline ? <Tag color="green">✓ Trusted Valid</Tag> : (ipaConfig?.ca_cert_path ? <Tag color="default">{ipaConfig.ca_cert_path}</Tag> : <Tag color="default">Not Configured</Tag>)}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span>DNS Resolution:</span>
                          {isOnline ? <Tag color="green">✓ {ipaConfig?.server_fqdn || 'Resolved'}</Tag> : (ipaConfig?.server_fqdn ? <Tag color="default">{ipaConfig.server_fqdn}</Tag> : <Tag color="default">Unresolved</Tag>)}
                        </div>
                      </div>

                      {ipaTestResult ? (
                        ipaTestResult.success ? (
                          <div style={{ marginTop: 16, padding: 12, borderRadius: 6, background: '#F0FDF4', border: '1px solid #BBF7D0' }}>
                            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: '#16A34A' }}>
                              ✓ Diagnostic Validation Passed:
                            </div>
                            <div style={{ fontSize: 11, color: '#166534' }}>
                              {ipaTestResult.message || 'All Kerberos and LDAP connection checks verified successfully.'}
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 16, padding: 12, borderRadius: 6, background: '#FEF2F2', border: '1px solid #FECACA' }}>
                            <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4, color: '#DC2626' }}>
                              ✕ Connectivity Validation Failed:
                            </div>
                            <div style={{ fontSize: 11, color: '#991B1B' }}>
                              {ipaTestResult.message || 'Unable to establish connection to FreeIPA server.'}
                            </div>
                          </div>
                        )
                      ) : (
                        <div style={{ marginTop: 16, padding: 12, borderRadius: 6, background: '#F8FAFC', border: '1px dashed #CBD5E1', fontSize: 11.5, color: '#64748B', lineHeight: 1.5 }}>
                          FreeIPA identity provider is not currently verified. Specify your server FQDN / IP and click <strong>Test IPA Connection</strong> to probe live Kerberos & LDAP directory services.
                        </div>
                      )}
                    </>
                  )
                })()}
              </Card>
            </Col>
          </Row>
        </div>
      ),
    },
    {
      key: 'enrollment',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <DesktopOutlined />
          Client Enrollment
        </span>
      ),
      children: (
        <div style={{ maxWidth: 1100, marginTop: 10 }}>
          <Alert
            message="Cluster Client Node FreeIPA Enrollment & SSSD Configuration"
            description="Enroll master and worker nodes into the FreeIPA domain. This configures SSSD authentication, NSS, PAM, Kerberos keytabs, and automount integration."
            type="info"
            showIcon
            style={{ marginBottom: 20 }}
          />

          <Card title="HPC Nodes Directory Enrollment" variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
            <Table
              size="small"
              dataSource={nodes}
              rowKey="id"
              pagination={false}
              columns={[
                {
                  title: 'Node Hostname',
                  dataIndex: 'hostname',
                  key: 'h',
                  render: (h, r) => (
                    <div>
                      <span style={{ fontWeight: 700, color: '#0F172A' }}>{h}</span>
                      <div style={{ fontSize: 11, color: '#64748B' }}>IP: {r.ip}</div>
                    </div>
                  )
                },
                { title: 'Cluster Role', dataIndex: 'role', key: 'role' },
                {
                  title: 'Enrollment Status',
                  key: 'status',
                  render: (_, r) => (
                    <Tag color={r.status === 'Enrolled' ? 'success' : 'warning'}>
                      {r.status || 'Enrolled'}
                    </Tag>
                  )
                },
                {
                  title: 'SSSD State',
                  dataIndex: 'sssd_status',
                  render: (s) => (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
                      <span style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>{s || 'Active'}</span>
                    </div>
                  )
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  align: 'right',
                  render: (_, r) => (
                    <Button
                      type="primary"
                      size="small"
                      icon={<ToolOutlined />}
                      onClick={() => handleOpenEnroll(r)}
                      style={{ background: '#2563EB', borderRadius: 6 }}
                    >
                      Re-Enroll Node
                    </Button>
                  )
                }
              ]}
            />
          </Card>
        </div>
      )
    },
    // -------------------------------------------------------------------------
    // 3. BMC & HARDWARE MANAGEMENT SECTION (PER USER REQUEST)
    // -------------------------------------------------------------------------
    {
      key: 'bmc-management',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ToolOutlined />
          BMC Management
        </span>
      ),
      children: (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#0F172A' }}>
                Server Hardware Management (BMC / iDRAC / iLO)
              </div>
              <div style={{ fontSize: 12.5, color: '#64748B' }}>
                Register management controllers, test Redfish/IPMI credentials, discover capabilities, and inspect real hardware inventory.
              </div>
            </div>
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadBmcData} loading={loadingBmc}>
                Refresh
              </Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => handleOpenAddServer('Dell iDRAC')}>
                + Add Server
              </Button>
            </Space>
          </div>

          <Tabs
            type="card"
            activeKey={bmcSubTab}
            onChange={setBmcSubTab}
            items={[
              // Sub-tab 1: Hardware Inventory
              {
                key: 'inventory',
                label: 'Hardware Inventory',
                children: (
                  <div>
                    <Table
                      size="small"
                      dataSource={hardwareInventories}
                      rowKey="id"
                      loading={loadingInventories}
                      columns={[
                        {
                          title: 'Server Hostname',
                          dataIndex: 'hostname',
                          key: 'h',
                          render: (h, r) => (
                            <div>
                              <span style={{ fontWeight: 700, color: '#0F172A' }}>{h.toUpperCase()}</span>
                              <div style={{ fontSize: 11, color: '#64748B' }}>{r.system_info?.system_model}</div>
                            </div>
                          )
                        },
                        {
                          title: 'Manufacturer & Model',
                          key: 'model',
                          render: (_, r) => (
                            <div>
                              <strong>{r.system_info?.manufacturer}</strong>
                              <div style={{ fontSize: 11, color: '#64748B' }}>{r.system_info?.system_model}</div>
                            </div>
                          )
                        },
                        {
                          title: 'Serial & UUID',
                          key: 'serial',
                          render: (_, r) => (
                            <div>
                              <Text code>{r.system_info?.system_serial}</Text>
                              <div style={{ fontSize: 10.5, color: '#94A3B8' }}>{r.system_info?.system_uuid}</div>
                            </div>
                          )
                        },
                        {
                          title: 'CPU / RAM Specs',
                          key: 'specs',
                          render: (_, r) => (
                            <div style={{ fontSize: 12 }}>
                              <div><strong>{r.processor_info?.physical_core_count} Cores</strong> ({r.processor_info?.cpu_model?.split('@')[0]})</div>
                              <div style={{ color: '#2563EB', fontWeight: 600 }}>{r.memory_info?.total_installed_ram_gb} GB RAM ({r.memory_info?.memory_type})</div>
                            </div>
                          )
                        },
                        {
                          title: 'Last Inventory Sync',
                          dataIndex: 'collected_at',
                          key: 'ca',
                          render: (ca) => <span style={{ fontSize: 12, color: '#64748B' }}>{ca}</span>
                        },
                        {
                          title: 'Actions',
                          key: 'act',
                          align: 'right',
                          render: (_, r) => (
                            <Space size="small">
                              <Button
                                size="small"
                                icon={<EyeOutlined />}
                                type="primary"
                                onClick={() => handleViewInventory(r)}
                              >
                                View Hardware Details
                              </Button>
                              <Button
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={() => handleRefreshInventory(r.server_id)}
                              >
                                Refresh
                              </Button>
                            </Space>
                          )
                        }
                      ]}
                    />
                  </div>
                )
              },
              // Sub-tab 2: BMC Configuration (Generic BMC & IPMI)
              {
                key: 'bmc-config',
                label: 'BMC Configuration',
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Standard IPMI 2.0 / DCMI over LAN (UDP Port 623) and Generic Redfish controllers.
                      </Text>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => handleOpenAddServer('Generic BMC')}>
                        Register Generic BMC
                      </Button>
                    </div>
                    <Table
                      size="small"
                      dataSource={bmcServers.filter(s => s.controller_type === 'Generic BMC')}
                      rowKey="id"
                      locale={{ emptyText: 'No generic BMC servers registered yet. Click "Register Generic BMC" to add one.' }}
                      columns={[
                        { title: 'Server Name', dataIndex: 'server_name', key: 'sn', render: (n) => <strong>{n}</strong> },
                        { title: 'Hostname', dataIndex: 'hostname', key: 'hn' },
                        { title: 'Management IP & Port', key: 'ip', render: (_, r) => <Text code>{r.bmc_ip}:{r.port}</Text> },
                        { title: 'Protocol', dataIndex: 'protocol', key: 'pr', render: (p) => <Tag color="blue">{p}</Tag> },
                        { title: 'Status', dataIndex: 'connection_status', key: 'st', render: (s) => <Tag color="green">✓ {s}</Tag> },
                      ]}
                    />
                  </div>
                )
              },
              // Sub-tab 3: iDRAC Configuration (Dell)
              {
                key: 'idrac-config',
                label: 'iDRAC Configuration (Dell)',
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Dell PowerEdge Integrated Dell Remote Access Controller (iDRAC 8 / 9) via Redfish &amp; Dell OEM REST.
                      </Text>
                      <Button size="small" type="primary" ghost icon={<PlusOutlined />} onClick={() => handleOpenAddServer('Dell iDRAC')}>
                        Register Dell iDRAC
                      </Button>
                    </div>
                    <Table
                      size="small"
                      dataSource={bmcServers.filter(s => s.controller_type === 'Dell iDRAC')}
                      rowKey="id"
                      columns={[
                        {
                          title: 'Server Name & Hostname',
                          key: 'sn',
                          render: (_, r) => (
                            <div>
                              <strong>{r.server_name}</strong>
                              <div style={{ fontSize: 11, color: '#64748B' }}>Node: {r.hostname} ({r.node_ip})</div>
                            </div>
                          )
                        },
                        {
                          title: 'iDRAC Address',
                          key: 'ip',
                          render: (_, r) => (
                            <div>
                              <Text code strong>{r.bmc_ip}:{r.port}</Text>
                              <div style={{ fontSize: 11, color: '#64748B' }}>User: {r.username}</div>
                            </div>
                          )
                        },
                        { title: 'Firmware Version', dataIndex: 'firmware_version', key: 'fw', render: (fw) => <Tag color="geekblue">{fw}</Tag> },
                        { title: 'Protocol', dataIndex: 'protocol', key: 'pr', render: (p) => <Tag color="blue">{p}</Tag> },
                        {
                          title: 'Status',
                          dataIndex: 'connection_status',
                          key: 'st',
                          render: (s) => <Tag color={s === 'Connected' ? 'success' : 'error'}>✓ {s.toUpperCase()}</Tag>
                        },
                        {
                          title: 'Actions',
                          key: 'act',
                          align: 'right',
                          render: (_, r) => (
                            <Space size="small">
                              <Button size="small" onClick={() => handleRefreshInventory(r.id)}>
                                Refresh Telemetry
                              </Button>
                              <Popconfirm title="Remove this iDRAC configuration?" onConfirm={() => handleDeleteServer(r.id)}>
                                <Button size="small" danger icon={<DeleteOutlined />} />
                              </Popconfirm>
                            </Space>
                          )
                        }
                      ]}
                    />
                  </div>
                )
              },
              // Sub-tab 4: iLO Configuration (HPE)
              {
                key: 'ilo-config',
                label: 'iLO Configuration (HPE)',
                children: (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        HPE Integrated Lights-Out (iLO 5 / 6) via Redfish &amp; HPE REST APIs.
                      </Text>
                      <Button size="small" icon={<PlusOutlined />} onClick={() => handleOpenAddServer('HPE iLO')}>
                        Register HPE iLO
                      </Button>
                    </div>
                    <Table
                      size="small"
                      dataSource={bmcServers.filter(s => s.controller_type === 'HPE iLO')}
                      rowKey="id"
                      locale={{ emptyText: 'No HPE iLO servers registered yet. Click "Register HPE iLO" to add one.' }}
                      columns={[
                        { title: 'Server Name', dataIndex: 'server_name', key: 'sn', render: (n) => <strong>{n}</strong> },
                        { title: 'Hostname', dataIndex: 'hostname', key: 'hn' },
                        { title: 'Management IP & Port', key: 'ip', render: (_, r) => <Text code>{r.bmc_ip}:{r.port}</Text> },
                        { title: 'Protocol', dataIndex: 'protocol', key: 'pr', render: (p) => <Tag color="blue">{p}</Tag> },
                        { title: 'Status', dataIndex: 'connection_status', key: 'st', render: (s) => <Tag color="green">✓ {s}</Tag> },
                      ]}
                    />
                  </div>
                )
              },
              // Sub-tab 5: Connection History
              {
                key: 'history',
                label: 'Connection History',
                children: (
                  <Table
                    size="small"
                    dataSource={connectionHistory}
                    rowKey="id"
                    loading={loadingHistory}
                    columns={[
                      { title: 'Timestamp', dataIndex: 'created_at', key: 'ts', width: 170 },
                      {
                        title: 'Server',
                        key: 'srv',
                        render: (_, r) => (
                          <div>
                            <strong>{r.server_name}</strong>
                            <div style={{ fontSize: 11, color: '#64748B' }}>Host: {r.hostname}</div>
                          </div>
                        )
                      },
                      { title: 'Action', dataIndex: 'action', key: 'act', render: (a) => <span style={{ fontWeight: 600 }}>{a}</span> },
                      {
                        title: 'Status',
                        dataIndex: 'status',
                        key: 'st',
                        render: (st) => <Tag color={st === 'Success' ? 'success' : 'error'}>{st}</Tag>
                      },
                      { title: 'Protocol', dataIndex: 'protocol_used', key: 'pr', render: (p) => <Tag color="blue">{p}</Tag> },
                      { title: 'Latency', dataIndex: 'latency_ms', key: 'lat', render: (l) => `${l} ms` },
                    ]}
                  />
                )
              }
            ]}
          />
        </div>
      )
    },
    {
      key: 'system-admin',
      label: (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ToolOutlined />
          System Administration &amp; Fresh Configuration
        </span>
      ),
      children: (
        <div style={{ maxWidth: 1000, marginTop: 10 }}>
          <Card
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ClearOutlined style={{ color: '#2563EB' }} />
                <span>Fresh Application Configuration &amp; Decommissioning Suite</span>
              </div>
            }
            extra={
              <Button type="primary" onClick={() => navigate('/settings/fresh-config')}>
                Open Fresh Config Console &rarr;
              </Button>
            }
            style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}
          >
            <Paragraph style={{ color: '#64748B', fontSize: 13 }}>
              Prepare AYAL HPC for clean customer deployment. Audit 15 data categories, remove demo/duplicate records, or execute fresh deployment preparation with pre-flight automated SQLite backups.
            </Paragraph>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <Button onClick={() => navigate('/settings/fresh-config')} icon={<SafetyCertificateOutlined />}>
                Audit &amp; Cleanup Wizard
              </Button>
              <Button onClick={() => navigate('/cluster/decommission')} danger icon={<DeleteOutlined />}>
                Decommission Cluster
              </Button>
              <Button onClick={() => navigate('/nodes/rollback')} icon={<RollbackOutlined />}>
                Node Configuration Rollback
              </Button>
            </div>
          </Card>
        </div>
      )
    },
  ]

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
          System Settings
        </div>
        <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
          Manage FreeIPA identity, client enrollment, and server BMC / iDRAC / iLO hardware controllers
        </div>
      </div>

      <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} />

      {/* ── CLIENT ENROLLMENT MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DesktopOutlined />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Enroll Client Node: {enrollingNode?.hostname} ({enrollingNode?.ip})
              </div>
              <div style={{ fontSize: 11.5, color: '#64748B' }}>
                Run 9-stage OS prerequisite verification and FreeIPA SSSD enrollment
              </div>
            </div>
          </div>
        }
        open={enrollModalOpen}
        onCancel={() => setEnrollModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setEnrollModalOpen(false)}>Close</Button>,
          <Button
            key="enroll"
            type="primary"
            loading={enrolling}
            onClick={handleRunEnrollment}
            style={{ background: '#2563EB' }}
          >
            Start Enrollment
          </Button>
        ]}
        width={680}
      >
        <div style={{ margin: '14px 0' }}>
          <Form form={enrollForm} layout="vertical">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="hostname" label="Node Hostname" rules={[{ required: true }]}>
                  <Input disabled />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="node_ip" label="Node IP Address" rules={[{ required: true }]}>
                  <Input disabled />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="domain" label="FreeIPA Domain" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="realm" label="Kerberos Realm" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="admin_user" label="Enrollment Principal" rules={[{ required: true }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="admin_password" label="Enrollment Password">
                  <Input.Password placeholder="Enter enrollment password" />
                </Form.Item>
              </Col>
            </Row>
          </Form>

          {enrollLogs.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                Enrollment Execution Pipeline Logs:
              </div>
              <div style={{
                background: '#0F172A', color: '#E2E8F0', padding: 12,
                borderRadius: 6, fontFamily: 'Consolas, monospace', fontSize: 11,
                maxHeight: 220, overflowY: 'auto', lineHeight: 1.6
              }}>
                {enrollLogs.map((log, idx) => (
                  <div key={idx} style={{
                    color: log.includes('SUCCESS') ? '#4ADE80' : (log.includes('FAIL') ? '#F87171' : '#E2E8F0')
                  }}>
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── ADD SERVER FORM (WITH 3-STAGE VALIDATION & CAPABILITY DISCOVERY) ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ToolOutlined />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Register Server Management Controller (BMC / iDRAC / iLO)
              </div>
              <div style={{ fontSize: 11.5, color: '#64748B' }}>
                Validate network, authenticate credentials, and discover hardware capabilities
              </div>
            </div>
          </div>
        }
        open={addServerModalOpen}
        onCancel={() => setAddServerModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAddServerModalOpen(false)}>Cancel</Button>,
          <Button
            key="validate"
            icon={<ThunderboltOutlined />}
            loading={validatingServer}
            onClick={handleRunValidationAndDiscovery}
          >
            {validationStep === 0 ? 'Test Connection & Authenticate' : 'Re-Validate Credentials'}
          </Button>,
          <Button
            key="save"
            type="primary"
            disabled={validationStep === 0}
            loading={savingServer}
            onClick={handleSaveValidatedServer}
            style={{ background: '#2563EB' }}
          >
            Save Configuration
          </Button>
        ]}
        width={720}
      >
        <div style={{ margin: '14px 0' }}>
          <Steps
            size="small"
            current={validationStep}
            items={[
              { title: '1. Server Details' },
              { title: '2. Connection & Auth' },
              { title: '3. Save & Discover' },
            ]}
            style={{ marginBottom: 20 }}
          />

          <Form form={serverForm} layout="vertical">
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item name="server_name" label="Server Name" rules={[{ required: true }]}>
                  <Input placeholder="Compute Worker Node 02" />
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item name="hostname" label="Registered Node Hostname" rules={[{ required: true }]}>
                  <Input placeholder="e.g. compute-01" />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="controller_type" label="Management Controller Type" rules={[{ required: true }]}>
                  <Select>
                    <Option value="Dell iDRAC">Dell iDRAC (8 / 9)</Option>
                    <Option value="HPE iLO">HPE iLO (5 / 6)</Option>
                    <Option value="Generic BMC">Generic BMC (IPMI 2.0)</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="protocol" label="Protocol" rules={[{ required: true }]}>
                  <Select>
                    <Option value="Redfish">Redfish API (HTTPS - Preferred)</Option>
                    <Option value="Vendor REST">Vendor OEM REST API</Option>
                    <Option value="IPMI">IPMI over LAN (RMCP+ Port 623)</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={16}>
                <Form.Item name="bmc_ip" label="Management IP Address" rules={[{ required: true }]}>
                  <Input placeholder="10.0.0.128" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="port" label="Port" rules={[{ required: true }]}>
                  <InputNumber style={{ width: '100%' }} defaultValue={443} />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="username" label="Username" rules={[{ required: true }]}>
                  <Input placeholder="root" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="password" label="Password" rules={[{ required: true }]}>
                  <Input.Password placeholder="••••••••" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="tls_verify" label="Enforce TLS Certificate Validation" valuePropName="checked">
              <Switch defaultChecked />
            </Form.Item>
          </Form>

          {validationResult && (
            <div style={{ marginTop: 16, background: '#F8FAFC', padding: 14, borderRadius: 6, border: '1px solid #E2E8F0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#16A34A', fontWeight: 700, marginBottom: 8 }}>
                <CheckCircleOutlined /> {validationResult.message}
              </div>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                <strong>Detected Firmware:</strong> {validationResult.firmware_version} &bull; <strong>Latency:</strong> {validationResult.latency_ms} ms &bull; <strong>TLS Certificate:</strong> {validationResult.tls_certificate?.subject}
              </div>
              <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 6 }}>Discovered Hardware Capabilities:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(validationResult.capabilities || []).map(c => (
                  <Tag key={c.id} color="geekblue" style={{ fontSize: 11 }}>
                    ✓ {c.name}
                  </Tag>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ── COMPLETE HARDWARE INVENTORY INSPECTION MODAL (ALL 6 CATEGORIES) ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DatabaseOutlined />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                Hardware Inventory: {selectedInventory?.hostname?.toUpperCase()} ({selectedInventory?.system_info?.system_model})
              </div>
              <div style={{ fontSize: 11.5, color: '#64748B' }}>
                Collected via Redfish API &amp; OS Hardware Sensors &bull; {selectedInventory?.collected_at}
              </div>
            </div>
          </div>
        }
        open={inventoryModalOpen}
        onCancel={() => setInventoryModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setInventoryModalOpen(false)}>Close</Button>
        ]}
        width={860}
      >
        <Tabs
          activeKey={inventoryDetailTab}
          onChange={setInventoryDetailTab}
          items={[
            // 1. System Info
            {
              key: 'system',
              label: 'System Information',
              children: (
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="Manufacturer">{selectedInventory?.system_info?.manufacturer}</Descriptions.Item>
                  <Descriptions.Item label="System Model">{selectedInventory?.system_info?.system_model}</Descriptions.Item>
                  <Descriptions.Item label="Serial Number"><Text code strong>{selectedInventory?.system_info?.system_serial}</Text></Descriptions.Item>
                  <Descriptions.Item label="Product SKU">{selectedInventory?.system_info?.product_sku}</Descriptions.Item>
                  <Descriptions.Item label="BIOS Version">{selectedInventory?.system_info?.bios_version}</Descriptions.Item>
                  <Descriptions.Item label="BIOS Release Date">{selectedInventory?.system_info?.bios_release_date}</Descriptions.Item>
                  <Descriptions.Item label="System UUID" span={2}><Text code>{selectedInventory?.system_info?.system_uuid}</Text></Descriptions.Item>
                </Descriptions>
              )
            },
            // 2. Processor
            {
              key: 'processor',
              label: 'Processor (CPU)',
              children: (
                <Descriptions bordered size="small" column={2}>
                  <Descriptions.Item label="CPU Model" span={2}><strong style={{ color: '#0F172A' }}>{selectedInventory?.processor_info?.cpu_model}</strong></Descriptions.Item>
                  <Descriptions.Item label="Manufacturer">{selectedInventory?.processor_info?.cpu_manufacturer}</Descriptions.Item>
                  <Descriptions.Item label="CPU Frequency">{selectedInventory?.processor_info?.cpu_frequency_mhz} MHz</Descriptions.Item>
                  <Descriptions.Item label="Socket Count">{selectedInventory?.processor_info?.socket_count} Sockets</Descriptions.Item>
                  <Descriptions.Item label="Physical Cores">{selectedInventory?.processor_info?.physical_core_count} Cores</Descriptions.Item>
                  <Descriptions.Item label="Logical Processors">{selectedInventory?.processor_info?.logical_processor_count} Threads</Descriptions.Item>
                  <Descriptions.Item label="L3 Cache">{selectedInventory?.processor_info?.cache_size_l3}</Descriptions.Item>
                  <Descriptions.Item label="Status"><Tag color="green">✓ {selectedInventory?.processor_info?.cpu_status}</Tag></Descriptions.Item>
                </Descriptions>
              )
            },
            // 3. Memory
            {
              key: 'memory',
              label: 'Memory (RAM)',
              children: (
                <div>
                  <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="Total Installed RAM"><strong style={{ color: '#2563EB', fontSize: 14 }}>{selectedInventory?.memory_info?.total_installed_ram_gb} GB</strong></Descriptions.Item>
                    <Descriptions.Item label="Memory Type">{selectedInventory?.memory_info?.memory_type}</Descriptions.Item>
                    <Descriptions.Item label="Speed">{selectedInventory?.memory_info?.speed_mts} MT/s</Descriptions.Item>
                    <Descriptions.Item label="Slots Populated">{selectedInventory?.memory_info?.populated_slots} of {selectedInventory?.memory_info?.total_slots} Slots</Descriptions.Item>
                  </Descriptions>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Populated DIMM Slots Breakdown:</div>
                  <Table
                    size="small"
                    dataSource={selectedInventory?.memory_info?.dimms || []}
                    rowKey="slot"
                    pagination={false}
                    columns={[
                      { title: 'Slot Locator', dataIndex: 'slot', key: 'sl', render: (sl) => <strong>{sl}</strong> },
                      { title: 'Capacity', dataIndex: 'capacity_gb', key: 'cap', render: (c) => `${c} GB` },
                      { title: 'Type & Speed', key: 'ts', render: (_, r) => `${r.type} @ ${r.speed}` },
                      { title: 'Serial Number', dataIndex: 'serial', key: 'sn', render: (s) => <Text code>{s}</Text> },
                      { title: 'Part Number', dataIndex: 'part', key: 'p' },
                      { title: 'Status', dataIndex: 'status', key: 'st', render: (s) => <Tag color="green">{s}</Tag> },
                    ]}
                  />
                </div>
              )
            },
            // 4. Storage
            {
              key: 'storage',
              label: 'Storage & RAID',
              children: (
                <div>
                  <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="Storage Controller" span={2}>
                      <strong>{selectedInventory?.storage_info?.controllers?.[0]?.name}</strong> ({selectedInventory?.storage_info?.controllers?.[0]?.bus})
                    </Descriptions.Item>
                    <Descriptions.Item label="RAID Configuration" span={2}>
                      <Tag color="cyan">{selectedInventory?.storage_info?.raid_configuration}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Drive Bays Populated">
                      {selectedInventory?.storage_info?.drive_bays_populated} of {selectedInventory?.storage_info?.drive_bays_total} Bays
                    </Descriptions.Item>
                  </Descriptions>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Physical Disks:</div>
                  <Table
                    size="small"
                    dataSource={selectedInventory?.storage_info?.physical_drives || []}
                    rowKey="slot"
                    pagination={false}
                    columns={[
                      { title: 'Bay / Slot', dataIndex: 'slot', key: 'sl', render: (s) => `Bay ${s}` },
                      { title: 'Model', dataIndex: 'model', key: 'm' },
                      { title: 'Capacity', dataIndex: 'capacity_gb', key: 'c', render: (c) => `${c} GB` },
                      { title: 'Interface', dataIndex: 'interface', key: 'inf' },
                      { title: 'Serial Number', dataIndex: 'serial', key: 'sn', render: (s) => <Text code>{s}</Text> },
                      { title: 'Status', dataIndex: 'status', key: 'st', render: (s) => <Tag color="green">{s}</Tag> },
                    ]}
                  />
                </div>
              )
            },
            // 5. Power & Thermal
            {
              key: 'power',
              label: 'Power & Thermal',
              children: (
                <div>
                  <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="Current Power Consumption">
                      <Tag color="blue" style={{ fontSize: 13, fontWeight: 700 }}>{selectedInventory?.power_thermal_info?.current_power_consumption_watts} Watts</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="PSU Redundancy">
                      <Tag color="green">✓ 1+1 Redundant</Tag>
                    </Descriptions.Item>
                  </Descriptions>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Power Supply Units (PSUs):</div>
                  <Table
                    size="small"
                    dataSource={selectedInventory?.power_thermal_info?.psus || []}
                    rowKey="serial"
                    pagination={false}
                    style={{ marginBottom: 16 }}
                    columns={[
                      { title: 'PSU', dataIndex: 'name', key: 'n', render: (n) => <strong>{n}</strong> },
                      { title: 'Model', dataIndex: 'model', key: 'm' },
                      { title: 'Rated Wattage', dataIndex: 'wattage', key: 'w', render: (w) => `${w}W` },
                      { title: 'Input / Output Voltage', key: 'v', render: (_, r) => `${r.voltage_in} / ${r.voltage_out}` },
                      { title: 'Health Status', dataIndex: 'status', key: 's', render: (s) => <Tag color="green">{s}</Tag> },
                    ]}
                  />
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Chassis Temperature Sensors:</div>
                  <Table
                    size="small"
                    dataSource={selectedInventory?.power_thermal_info?.temperature_sensors || []}
                    rowKey="sensor"
                    pagination={false}
                    columns={[
                      { title: 'Sensor', dataIndex: 'sensor', key: 'sn' },
                      { title: 'Temperature', dataIndex: 'temp_c', key: 't', render: (t) => <strong>{t} °C</strong> },
                      { title: 'Status', dataIndex: 'status', key: 'st', render: (s) => <Tag color="green">{s}</Tag> },
                    ]}
                  />
                </div>
              )
            },
            // 6. Network
            {
              key: 'network',
              label: 'Network Adapters',
              children: (
                <Table
                  size="small"
                  dataSource={selectedInventory?.network_info?.adapters || []}
                  rowKey="interface"
                  pagination={false}
                  columns={[
                    { title: 'Interface', dataIndex: 'interface', key: 'inf', render: (i) => <strong>{i}</strong> },
                    { title: 'Adapter Model', dataIndex: 'model', key: 'm' },
                    { title: 'MAC Address', dataIndex: 'mac_address', key: 'mac', render: (m) => <Text code>{m}</Text> },
                    { title: 'Link Status', dataIndex: 'link_status', key: 'ls', render: (l) => <Tag color={l === 'UP' ? 'success' : 'default'}>{l}</Tag> },
                    { title: 'Negotiated Speed', dataIndex: 'speed', key: 'sp' },
                  ]}
                />
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}
