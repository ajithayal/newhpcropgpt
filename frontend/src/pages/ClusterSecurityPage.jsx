import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import {
  Card, Button, Row, Col, Typography, Space, Tag, Alert, Table, Switch, message, Divider
} from 'antd'
import {
  SafetyCertificateOutlined, LockOutlined, KeyOutlined,
  CheckCircleOutlined, CloseCircleOutlined, SafetyOutlined,
  CloudServerOutlined, DesktopOutlined, DatabaseOutlined, SettingOutlined,
  CodeOutlined, ArrowLeftOutlined, EyeOutlined
} from '@ant-design/icons'
import { clusterAPI } from '../services/api'

const { Title, Text } = Typography

export default function ClusterSecurityPage() {
  const navigate = useNavigate()
  const { clusterId } = useParams()
  const [searchParams] = useSearchParams()
  const activeClusterId = clusterId || searchParams.get('id') || null

  const [cluster, setCluster] = useState(null)
  const [rootLogin, setRootLogin] = useState(true)
  const [passwordAuth, setPasswordAuth] = useState(false)
  const [firewallActive, setFirewallActive] = useState(true)
  const [selinuxEnforcing, setSelinuxEnforcing] = useState(false)

  useEffect(() => {
    clusterAPI.getOverview().then(res => {
      const list = res.data?.clusters || []
      const found = list.find(c => c.id === activeClusterId || c.cluster_id === activeClusterId) || list[0]
      if (found) setCluster(found)
    }).catch(() => {})
  }, [activeClusterId])

  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', path: `/cluster/overview?id=${activeClusterId}` },
    { key: 'nodes', label: 'Node Management', path: `/cluster/nodes?id=${activeClusterId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${activeClusterId}` },
    { key: 'terminal', label: 'Terminal', path: `/cluster/terminal?id=${activeClusterId}` },
    { key: 'slurm', label: 'Slurm Configuration', path: `/cluster/slurm?id=${activeClusterId}` },
    { key: 'health', label: 'Cluster Health', path: `/cluster/health?id=${activeClusterId}` },
    { key: 'security', label: 'Security', active: true, path: `/cluster/security?id=${activeClusterId}` },
  ]

  const PORT_POLICIES = [
    { port: 22, protocol: 'TCP', service: 'OpenSSH Remote Management', scope: 'Management Subnet (10.0.0.0/24)', status: 'OPEN' },
    { port: 6817, protocol: 'TCP', service: 'Slurm Controller Daemon (slurmctld)', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 6818, protocol: 'TCP', service: 'Slurm Compute Daemon (slurmd)', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 2049, protocol: 'TCP', service: 'NFSv4 Shared Storage Service', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 111, protocol: 'TCP/UDP', service: 'RPC Portmapper (rpcbind)', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 389, protocol: 'TCP', service: 'FreeIPA LDAP Directory', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 88, protocol: 'TCP/UDP', service: 'Kerberos KDC Authentication', scope: 'Cluster Nodes Only', status: 'OPEN' },
    { port: 9100, protocol: 'TCP', service: 'Prometheus Node Exporter', scope: 'Monitoring Host', status: 'OPEN' },
  ]

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40, color: '#F1F5F9' }}>
      {/* ── BREADCRUMB & HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#94A3B8' }}>
          <SafetyCertificateOutlined style={{ fontSize: 16, color: '#38BDF8' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/cluster')}>Cluster</span>
          <span>&gt;</span>
          <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>{cluster?.name || 'Ayal HPC'}</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#38BDF8' }}>Security &amp; Zero-Trust Access Configuration</span>
        </div>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>
            Back to Overview
          </Button>
          <Button type="primary" onClick={() => message.success('Security policies saved and applied across cluster.')} style={{ background: '#2563EB' }}>
            Save Security Policy
          </Button>
        </Space>
      </div>

      {/* ── SUB-NAV BAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid #334155', marginBottom: 20,
        background: '#1E293B', borderRadius: 8, padding: '0 12px'
      }}>
        {HORIZONTAL_TABS.map((tab) => (
          <div
            key={tab.key}
            onClick={() => tab.path && navigate(tab.path)}
            style={{
              padding: '12px 16px', fontSize: 13,
              fontWeight: tab.active ? 700 : 500,
              color: tab.active ? '#38BDF8' : '#94A3B8',
              borderBottom: tab.active ? '2.5px solid #38BDF8' : '2.5px solid transparent',
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
            {tab.key === 'security' && <LockOutlined />}
            {tab.label}
          </div>
        ))}
      </div>

      {/* ── SECURITY POLICY CONTROLS ── */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        <Col span={12}>
          <div style={{ background: '#1E293B', borderRadius: 10, padding: 20, border: '1px solid #334155' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', marginBottom: 14 }}>
              SSH &amp; Node Authentication Policy
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#F1F5F9' }}>Permit Root SSH Login</div>
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>Allow administrators to connect to compute nodes via SSH key</div>
                </div>
                <Switch checked={rootLogin} onChange={setRootLogin} />
              </div>

              <Divider style={{ borderColor: '#334155', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#F1F5F9' }}>Password Authentication</div>
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>Enforce SSH public key authentication only (recommended: Disabled)</div>
                </div>
                <Switch checked={passwordAuth} onChange={setPasswordAuth} />
              </div>

              <Divider style={{ borderColor: '#334155', margin: '4px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#F1F5F9' }}>firewalld HPC Ruleset</div>
                  <div style={{ fontSize: 12, color: '#94A3B8' }}>Restrict traffic to internal cluster subnet (10.0.0.0/24)</div>
                </div>
                <Switch checked={firewallActive} onChange={setFirewallActive} />
              </div>
            </div>
          </div>
        </Col>

        <Col span={12}>
          <div style={{ background: '#1E293B', borderRadius: 10, padding: 20, border: '1px solid #334155' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', marginBottom: 14 }}>
              Munge &amp; Cryptographic Keys
            </div>

            <div style={{ background: '#0F172A', padding: '12px 16px', borderRadius: 8, border: '1px solid #334155', marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: '#38BDF8' }}>/etc/munge/munge.key</span>
                <Tag color="success">0400 • munge:munge</Tag>
              </div>
              <div style={{ fontSize: 12, color: '#94A3B8' }}>
                Uniform UID 981 and GID 981 synchronized across master and worker nodes.
              </div>
            </div>

            <div style={{ background: '#0F172A', padding: '12px 16px', borderRadius: 8, border: '1px solid #334155' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 700, color: '#38BDF8' }}>FreeIPA Kerberos KDC</span>
                <Tag color="cyan">REALM: LAYA.HPC.IN</Tag>
              </div>
              <div style={{ fontSize: 12, color: '#94A3B8' }}>
                SSSD client identity resolution with POSIX ACLs on /home, /apps, and /scratch.
              </div>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── FIREWALL PORT MATRIX ── */}
      <div style={{ background: '#1E293B', borderRadius: 10, padding: 20, border: '1px solid #334155' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#F1F5F9', marginBottom: 14 }}>
          Cluster Firewall Port Allocation &amp; Service Matrix
        </div>

        <Table
          dataSource={PORT_POLICIES}
          rowKey="port"
          pagination={false}
          columns={[
            { title: 'Port', dataIndex: 'port', render: (p) => <code style={{ color: '#38BDF8', fontWeight: 700 }}>{p}</code> },
            { title: 'Protocol', dataIndex: 'protocol', render: (pr) => <Tag color="blue">{pr}</Tag> },
            { title: 'HPC Service', dataIndex: 'service', render: (s) => <span style={{ fontWeight: 600, color: '#F1F5F9' }}>{s}</span> },
            { title: 'Allowed Scope', dataIndex: 'scope', render: (sc) => <span style={{ color: '#94A3B8' }}>{sc}</span> },
            { title: 'Status', dataIndex: 'status', render: (st) => <Tag color="success"><CheckCircleOutlined /> {st}</Tag> },
          ]}
        />
      </div>
    </div>
  )
}
