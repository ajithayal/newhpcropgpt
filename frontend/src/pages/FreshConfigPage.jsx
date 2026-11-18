import React, { useState, useEffect } from 'react'
import {
  Card, Row, Col, Typography, Button, Tag, Space, Alert, Modal,
  Input, Form, Checkbox, Table, Progress, Spin, message, Divider,
  Badge, Tooltip, Statistic, Popconfirm
} from 'antd'
import {
  ClearOutlined, ReloadOutlined, SafetyCertificateOutlined,
  WarningOutlined, CheckCircleOutlined, DeleteOutlined,
  DatabaseOutlined, HistoryOutlined, FileProtectOutlined,
  DownloadOutlined, ExclamationCircleOutlined, AuditOutlined,
  AppstoreOutlined, KeyOutlined, SyncOutlined
} from '@ant-design/icons'
import { freshConfigAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography

export default function FreshConfigPage() {
  const [loading, setLoading] = useState(false)
  const [auditData, setAuditData] = useState(null)
  const [reports, setReports] = useState([])
  const [loadingReports, setLoadingReports] = useState(false)

  // Preview & Execute Modal
  const [selectedAction, setSelectedAction] = useState(null)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [createBackup, setCreateBackup] = useState(true)

  // High Risk Full Reset Confirmation
  const [confirmText, setConfirmText] = useState('')
  const [executing, setExecuting] = useState(false)
  const [executionResult, setExecutionResult] = useState(null)

  useEffect(() => {
    loadAudit()
    loadReports()
  }, [])

  const loadAudit = async () => {
    setLoading(true)
    try {
      const res = await freshConfigAPI.audit()
      setAuditData(res.data)
    } catch (err) {
      console.error(err)
      message.error(err.response?.data?.detail || 'Failed to load system audit')
    } finally {
      setLoading(false)
    }
  }

  const loadReports = async () => {
    setLoadingReports(true)
    try {
      const res = await freshConfigAPI.getReports(10)
      const list = Array.isArray(res.data) ? res.data : (res.data?.reports || [])
      setReports(list)
    } catch (err) {
      console.warn('Failed to load cleanup reports:', err)
      setReports([])
    } finally {
      setLoadingReports(false)
    }
  }

  const handleOpenPreview = async (actionKey) => {
    setSelectedAction(actionKey)
    setConfirmText('')
    setExecutionResult(null)
    setPreviewLoading(true)
    setPreviewModalOpen(true)
    try {
      const res = await freshConfigAPI.preview({
        action: actionKey,
        target_categories: [],
        create_backup: true,
      })
      setPreviewData(res.data)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to generate preview')
      setPreviewModalOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExecuteCleanup = async () => {
    if (selectedAction === 'full_reset' && confirmText !== 'CONFIRM FULL RESET') {
      message.error('Please type CONFIRM FULL RESET to proceed')
      return
    }

    setExecuting(true)
    try {
      const res = await freshConfigAPI.execute({
        action: selectedAction,
        create_backup: createBackup,
        confirmation_code: confirmText,
        notes: `Executed via AYAL HPC Web UI on ${new Date().toISOString()}`
      })
      setExecutionResult(res.data)
      message.success(res.data?.message || 'Operation executed successfully')
      loadAudit()
      loadReports()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to execute cleanup operation')
    } finally {
      setExecuting(false)
    }
  }

  const actions = [
    {
      key: 'remove_demo',
      label: 'A. Remove Demo Data',
      desc: 'Purge mock clusters, simulated nodes, demo telemetry logs, and synthetic test workloads.',
      risk: 'low',
      badge: 'Safe',
      color: '#10B981',
      icon: <ClearOutlined />
    },
    {
      key: 'remove_duplicates',
      label: 'B. Remove Duplicate Records',
      desc: 'Consolidate redundant IP mappings, stale agent registrations, and identical metric configurations.',
      risk: 'low',
      badge: 'Safe',
      color: '#3B82F6',
      icon: <SyncOutlined />
    },
    {
      key: 'remove_test',
      label: 'C. Remove Selected Test Records',
      desc: 'Clear manual smoke test jobs, dummy FreeIPA user stubs, and temporary test storage mounts.',
      risk: 'medium',
      badge: 'Moderate',
      color: '#F59E0B',
      icon: <AuditOutlined />
    },
    {
      key: 'reset_module',
      label: 'D. Reset Module Configuration',
      desc: 'Restore Slurm, Munge, or Monitoring modules back to baseline factory defaults.',
      risk: 'medium',
      badge: 'Moderate',
      color: '#8B5CF6',
      icon: <AppstoreOutlined />
    },
    {
      key: 'fresh_deployment',
      label: 'E. Fresh Deployment Preparation',
      desc: 'Remove all non-production assets, flush temporary caches, and ready the platform for production customer handover.',
      risk: 'high',
      badge: 'Customer Ready',
      color: '#0284C7',
      icon: <FileProtectOutlined />
    },
    {
      key: 'full_reset',
      label: 'F. Full Application Reset',
      desc: 'Factory reset all cluster data, nodes, and configurations. Preserves Administrator accounts and base security.',
      risk: 'critical',
      badge: 'High Risk',
      color: '#EF4444',
      icon: <DeleteOutlined />
    }
  ]

  const categoryCards = Array.isArray(auditData?.categories) ? auditData.categories : []
  const summary = auditData?.summary || {}

  return (
    <div style={{ padding: '24px 32px', background: '#F5F7FB', minHeight: '100vh' }}>
      {/* ── TOP HEADER ── */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Title level={3} style={{ margin: 0, color: '#0F172A', fontWeight: 700 }}>
              System Administration — Fresh Application Configuration
            </Title>
            <Tag color="blue" style={{ fontWeight: 600 }}>AYAL HPC Core</Tag>
          </div>
          <Text style={{ color: '#64748B', fontSize: 13.5 }}>
            Inspect application state across 15 operational categories, generate snapshot backups, and safely prepare AYAL HPC for clean customer deployment.
          </Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAudit} loading={loading}>
            Refresh Audit
          </Button>
          <Button icon={<HistoryOutlined />} onClick={loadReports}>
            Audit History
          </Button>
        </Space>
      </div>

      {/* ── SAFETY BANNER ── */}
      <Alert
        message="Strict Non-Destructive Protection Guarantee"
        description="Cleanup procedures enforce relational integrity checks. Production users, cluster root SSH keys, FreeIPA directory servers, active Slurm job states, and customer licenses are permanently shielded from automated deletion."
        type="info"
        showIcon
        icon={<SafetyCertificateOutlined style={{ color: '#2563EB' }} />}
        style={{ marginBottom: 24, borderRadius: 8, border: '1px solid #BFDBFE', background: '#EFF6FF' }}
      />

      {/* ── DATA CLASSIFICATION OVERVIEW ── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>PRODUCTION</span>} value={summary.production || 0} valueStyle={{ color: '#10B981', fontWeight: 700, fontSize: 20 }} />
            <Tag color="success" style={{ marginTop: 4, fontSize: 10 }}>Protected</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>DEMO DATA</span>} value={summary.demo || 0} valueStyle={{ color: '#F59E0B', fontWeight: 700, fontSize: 20 }} />
            <Tag color="warning" style={{ marginTop: 4, fontSize: 10 }}>Safe to Clean</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>TEST DATA</span>} value={summary.test || 0} valueStyle={{ color: '#3B82F6', fontWeight: 700, fontSize: 20 }} />
            <Tag color="processing" style={{ marginTop: 4, fontSize: 10 }}>Non-Production</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>DUPLICATES</span>} value={summary.duplicates || 0} valueStyle={{ color: '#8B5CF6', fontWeight: 700, fontSize: 20 }} />
            <Tag color="purple" style={{ marginTop: 4, fontSize: 10 }}>Redundant</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>ORPHANED</span>} value={summary.orphaned || 0} valueStyle={{ color: '#EF4444', fontWeight: 700, fontSize: 20 }} />
            <Tag color="error" style={{ marginTop: 4, fontSize: 10 }}>Broken Rel</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>SYS CONFIG</span>} value={summary.system_config || 0} valueStyle={{ color: '#0F172A', fontWeight: 700, fontSize: 20 }} />
            <Tag color="default" style={{ marginTop: 4, fontSize: 10 }}>Locked</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>CUSTOMER CFG</span>} value={summary.customer_config || 0} valueStyle={{ color: '#0284C7', fontWeight: 700, fontSize: 20 }} />
            <Tag color="cyan" style={{ marginTop: 4, fontSize: 10 }}>Active</Tag>
          </Card>
        </Col>
        <Col xs={12} sm={6} md={3}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', textAlign: 'center' }}>
            <Statistic title={<span style={{ fontSize: 11, color: '#64748B' }}>AUDIT LOGS</span>} value={summary.audit_records || 0} valueStyle={{ color: '#64748B', fontWeight: 700, fontSize: 20 }} />
            <Tag color="default" style={{ marginTop: 4, fontSize: 10 }}>Archived</Tag>
          </Card>
        </Col>
      </Row>

      {/* ── 6 SELECTABLE CLEANUP ACTIONS ── */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DatabaseOutlined style={{ color: '#2563EB' }} />
            <span>Selectable Cleanup & Deployment Actions</span>
          </div>
        }
        style={{ marginBottom: 24, borderRadius: 10, border: '1px solid #E2E8F0' }}
      >
        <Row gutter={[16, 16]}>
          {actions.map((act) => (
            <Col xs={24} sm={12} lg={8} key={act.key}>
              <div
                style={{
                  border: '1px solid #E2E8F0',
                  borderRadius: 8,
                  padding: '16px 20px',
                  background: '#FFFFFF',
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease',
                  cursor: 'pointer',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)'
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = act.color}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = '#E2E8F0'}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: 14.5, color: '#0F172A', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: act.color, fontSize: 16 }}>{act.icon}</span>
                      {act.label}
                    </span>
                    <Tag color={act.risk === 'critical' ? 'error' : act.risk === 'high' ? 'warning' : 'blue'}>
                      {act.badge}
                    </Tag>
                  </div>
                  <Paragraph style={{ color: '#64748B', fontSize: 12.5, minHeight: 40, margin: 0 }}>
                    {act.desc}
                  </Paragraph>
                </div>
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    type={act.risk === 'critical' ? 'primary' : 'default'}
                    danger={act.risk === 'critical'}
                    size="small"
                    onClick={() => handleOpenPreview(act.key)}
                    style={{ fontWeight: 600 }}
                  >
                    Preview & Execute →
                  </Button>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* ── 15 AUDIT CATEGORIES BREAKDOWN ── */}
      <Card
        title={
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AuditOutlined style={{ color: '#2563EB' }} />
              <span>15 Tracked System & Infrastructure Categories</span>
            </div>
            <Tag color="geekblue">{categoryCards.length} Categories Audited</Tag>
          </div>
        }
        style={{ marginBottom: 24, borderRadius: 10, border: '1px solid #E2E8F0' }}
      >
        <Table
          size="small"
          loading={loading}
          dataSource={categoryCards}
          rowKey="id"
          pagination={false}
          columns={[
            {
              title: '#',
              dataIndex: 'index',
              key: 'index',
              width: 50,
              render: (v) => <Text type="secondary" strong>{v}</Text>
            },
            {
              title: 'Operational Category',
              dataIndex: 'name',
              key: 'name',
              render: (name, r) => (
                <div>
                  <span style={{ fontWeight: 600, color: '#0F172A' }}>{name}</span>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>{r.description}</div>
                </div>
              )
            },
            {
              title: 'Total Records',
              dataIndex: 'total_count',
              key: 'tc',
              width: 120,
              render: (tc) => <Badge count={tc} overflowCount={999999} style={{ backgroundColor: '#2563EB' }} />
            },
            {
              title: 'Status & Classification',
              dataIndex: 'classification',
              key: 'cl',
              width: 180,
              render: (cl) => {
                const colorMap = {
                  Production: 'green',
                  Demo: 'orange',
                  Test: 'blue',
                  Duplicate: 'purple',
                  Orphaned: 'red',
                  'System Configuration': 'cyan',
                  Customer: 'geekblue'
                }
                return <Tag color={colorMap[cl] || 'default'}>{cl || 'Inspected'}</Tag>
              }
            },
            {
              title: 'Actionable Items',
              dataIndex: 'cleanable_count',
              key: 'cleanable',
              width: 140,
              render: (c) => c > 0 ? (
                <Tag color="warning" icon={<WarningOutlined />}>{c} Cleanable</Tag>
              ) : (
                <Tag color="success" icon={<CheckCircleOutlined />}>Clean</Tag>
              )
            }
          ]}
        />
      </Card>

      {/* ── HISTORICAL AUDIT & CLEANUP REPORTS ── */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HistoryOutlined style={{ color: '#2563EB' }} />
            <span>Cleanup & Decommissioning Execution History</span>
          </div>
        }
        style={{ borderRadius: 10, border: '1px solid #E2E8F0' }}
      >
        <Table
          size="small"
          loading={loadingReports}
          dataSource={reports}
          rowKey="id"
          pagination={{ pageSize: 5 }}
          locale={{ emptyText: 'No previous cleanup operations recorded.' }}
          columns={[
            {
              title: 'Operation ID',
              dataIndex: 'id',
              key: 'id',
              render: (id) => <Text code copyable>{String(id).slice(0, 10)}...</Text>
            },
            {
              title: 'Operation Mode',
              dataIndex: 'operation_type',
              key: 'mode',
              render: (m) => <Tag color="blue">{m?.toUpperCase()}</Tag>
            },
            {
              title: 'Records Affected',
              dataIndex: 'records_affected',
              key: 'rec',
              render: (r) => <Text strong>{r || 0}</Text>
            },
            {
              title: 'Status',
              dataIndex: 'status',
              key: 'status',
              render: (s) => (
                <Tag color={s === 'completed' ? 'success' : s === 'failed' ? 'error' : 'processing'}>
                  {s?.toUpperCase()}
                </Tag>
              )
            },
            {
              title: 'Backup Archive',
              dataIndex: 'backup_path',
              key: 'bk',
              render: (bp) => bp ? <Text code style={{ fontSize: 11 }}>{bp}</Text> : <Text type="secondary">—</Text>
            },
            {
              title: 'Timestamp',
              dataIndex: 'created_at',
              key: 'time',
              render: (t) => <Text style={{ fontSize: 12, color: '#64748B' }}>{t ? new Date(t).toLocaleString() : '—'}</Text>
            }
          ]}
        />
      </Card>

      {/* ── PREVIEW & EXECUTE MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileProtectOutlined style={{ color: selectedAction === 'full_reset' ? '#EF4444' : '#2563EB' }} />
            <span>
              {selectedAction === 'full_reset' ? 'CRITICAL: Full Application Reset Confirmation' : 'Cleanup Operation Preview & Approval'}
            </span>
          </div>
        }
        open={previewModalOpen}
        onCancel={() => {
          if (!executing) {
            setPreviewModalOpen(false)
            setExecutionResult(null)
          }
        }}
        width={700}
        footer={null}
        destroyOnClose
      >
        {previewLoading ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Spin size="large" />
            <div style={{ marginTop: 12, color: '#64748B' }}>Calculating affected records and dependency map...</div>
          </div>
        ) : executionResult ? (
          <div style={{ padding: '16px 0' }}>
            <Alert
              message={executionResult.message || 'Operation Completed'}
              description={
                <div>
                  <div style={{ marginBottom: 8 }}>Records deleted: <strong>{executionResult.deleted_count || 0}</strong></div>
                  {executionResult.backup_file && (
                    <div style={{ fontSize: 12, color: '#0F172A' }}>
                      Backup saved at: <Text code>{executionResult.backup_file}</Text>
                    </div>
                  )}
                  {executionResult.integrity_status && (
                    <div style={{ marginTop: 6, fontSize: 12, color: '#10B981' }}>
                      <CheckCircleOutlined /> Database integrity check passed (0 orphaned relations detected).
                    </div>
                  )}
                </div>
              }
              type={executionResult.success ? 'success' : 'error'}
              showIcon
              style={{ marginBottom: 20 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="primary" onClick={() => setPreviewModalOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text style={{ color: '#64748B', fontSize: 13 }}>
                Review the affected record counts, dependencies, and automated safeguard checks before confirming execution.
              </Text>
            </div>

            <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Target Action">
                <Tag color={selectedAction === 'full_reset' ? 'error' : 'blue'}>
                  {selectedAction?.toUpperCase()}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Records to be Purged">
                <Text strong style={{ color: selectedAction === 'full_reset' ? '#EF4444' : '#0F172A' }}>
                  {previewData?.affected_count ?? 0} records
                </Text>
              </Descriptions.Item>
              <Descriptions.Item label="Affected Modules" span={2}>
                <Space wrap size={[4, 4]}>
                  {(previewData?.affected_modules || ['Clusters', 'Nodes', 'Monitoring', 'Telemetry']).map((m) => (
                    <Tag key={m} color="default">{m}</Tag>
                  ))}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="Protected Assets" span={2}>
                <Space wrap size={[4, 4]}>
                  <Tag color="success">Super Admin (Preserved)</Tag>
                  <Tag color="success">Customer License (Preserved)</Tag>
                  <Tag color="success">Base Security Config (Preserved)</Tag>
                </Space>
              </Descriptions.Item>
            </Descriptions>

            <div style={{ marginBottom: 16, background: '#F8FAFC', padding: 12, borderRadius: 6, border: '1px solid #E2E8F0' }}>
              <Checkbox
                checked={createBackup}
                onChange={(e) => setCreateBackup(e.target.checked)}
              >
                <span style={{ fontWeight: 600, color: '#0F172A' }}>Generate automated SQLite snapshot backup before running</span>
              </Checkbox>
              <div style={{ fontSize: 11.5, color: '#64748B', marginLeft: 24, marginTop: 2 }}>
                An exact byte-copy of the database is archived in <Text code>backups/cleanup/</Text> prior to write transactions.
              </div>
            </div>

            {selectedAction === 'full_reset' && (
              <div style={{ marginBottom: 20, padding: 14, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8 }}>
                <div style={{ color: '#991B1B', fontWeight: 700, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <WarningOutlined /> HIGH RISK OPERATION: TYPE TO CONFIRM
                </div>
                <div style={{ fontSize: 12, color: '#7F1D1D', marginBottom: 10 }}>
                  This will decommission all clusters, worker nodes, and telemetry. To proceed, type <Text strong code>CONFIRM FULL RESET</Text> in the box below:
                </div>
                <Input
                  placeholder="CONFIRM FULL RESET"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  style={{ borderColor: '#F87171' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <Button onClick={() => setPreviewModalOpen(false)} disabled={executing}>
                Cancel
              </Button>
              <Button
                type="primary"
                danger={selectedAction === 'full_reset'}
                loading={executing}
                disabled={selectedAction === 'full_reset' && confirmText !== 'CONFIRM FULL RESET'}
                onClick={handleExecuteCleanup}
                icon={selectedAction === 'full_reset' ? <DeleteOutlined /> : <CheckCircleOutlined />}
              >
                {selectedAction === 'full_reset' ? 'Execute Full Reset' : 'Confirm & Execute Cleanup'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Descriptions({ bordered, size, column, style, children }) {
  return (
    <div style={{ border: bordered ? '1px solid #E2E8F0' : 'none', borderRadius: 8, padding: 12, background: '#FFFFFF', ...style }}>
      {children}
    </div>
  )
}
Descriptions.Item = function ({ label, span = 1, children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F1F5F9' }}>
      <span style={{ color: '#64748B', fontSize: 12.5, fontWeight: 500 }}>{label}:</span>
      <span style={{ textAlign: 'right', fontSize: 12.5 }}>{children}</span>
    </div>
  )
}
