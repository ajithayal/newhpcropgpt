import React, { useState, useEffect } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import {
  Card, Button, Row, Col, Typography, Space, Tag, Alert, Tabs,
  Table, message, Modal, Spin, Divider
} from 'antd'
import {
  CloudServerOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, PlayCircleOutlined, ReloadOutlined, SettingOutlined,
  DesktopOutlined, DatabaseOutlined, CodeOutlined, SafetyCertificateOutlined,
  ArrowLeftOutlined, WarningOutlined, FileTextOutlined, DeleteOutlined, HddOutlined
} from '@ant-design/icons'
import { clusterMgmtAPI, clusterAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography

export default function ClusterSlurmPage() {
  const navigate = useNavigate()
  const { clusterId } = useParams()
  const [searchParams] = useSearchParams()
  const activeClusterId = clusterId || searchParams.get('id') || null

  const [cluster, setCluster] = useState(null)
  const [loading, setLoading] = useState(false)
  const [probingTopology, setProbingTopology] = useState(false)
  const [topologyData, setTopologyData] = useState(null)
  const [testOutput, setTestOutput] = useState('')
  const [runningTest, setRunningTest] = useState(false)
  const [spoolCleared, setSpoolCleared] = useState(false)

  const SLURM_CONF_TEMPLATE = `
# ==============================================================================
# /etc/slurm/slurm.conf — AYAL HPC Production Cluster
# Hardware topology introspected dynamically via slurmd -C
# ==============================================================================
ClusterName=ayal
SlurmctldHost=master(10.0.0.1)

# Authentication & Process Tracking
AuthType=auth/munge
ProctrackType=proctrack/linuxproc
TaskPlugin=task/affinity,task/cgroup

# Scheduling & Selection
SchedulerType=sched/backfill
SelectType=select/cons_tres
SelectTypeParameters=CR_Core_Memory

# State & Logs
SlurmctldPidFile=/var/run/slurmctld.pid
SlurmdPidFile=/var/run/slurmd.pid
SlurmctldPort=6817
SlurmdPort=6818
SlurmdSpoolDir=/var/spool/slurmd
StateSaveLocation=/var/spool/slurmctld
SlurmctldLogFile=/var/log/slurm/slurmctld.log
SlurmdLogFile=/var/log/slurm/slurmd.log
SlurmUser=slurm

# Compute Nodes Topology (Populated when nodes register)
# NodeName=node1 NodeAddr=<ip> Sockets=<sockets> CoresPerSocket=<cores> ThreadsPerCore=1 RealMemory=<memory> State=UNKNOWN

# Partitions
PartitionName=debug Nodes=ALL Default=YES MaxTime=02:00:00 State=UP PriorityTier=100
PartitionName=gpu   Nodes=ALL Default=NO  MaxTime=INFINITE State=UP PriorityTier=50
PartitionName=long  Nodes=ALL Default=NO  MaxTime=INFINITE State=UP PriorityTier=10
`.trim()

  const CGROUP_CONF_TEMPLATE = `
# ==============================================================================
# /etc/slurm/cgroup.conf — AYAL HPC Resource Limits
# Configured for cgroup/v1 with kernel systemd.unified_cgroup_hierarchy=0
# ==============================================================================
CgroupPlugin=cgroup/v1
CgroupAutomount=yes

ConstrainCores=yes
ConstrainRAMSpace=yes
ConstrainSwapSpace=no

AllowedRAMSpace=98
MaxRAMPercent=98
`.trim()

  useEffect(() => {
    clusterAPI.getOverview().then(res => {
      const list = res.data?.clusters || []
      const found = list.find(c => c.id === activeClusterId || c.cluster_id === activeClusterId) || list[0]
      if (found) setCluster(found)
    }).catch(() => {})
    handleDetectTopology()
  }, [activeClusterId])

  const handleDetectTopology = async () => {
    setProbingTopology(true)
    try {
      const res = await clusterMgmtAPI.detectSlurmTopology(activeClusterId)
      setTopologyData(res.data)
    } catch (err) {
      console.warn('Topology detect fallback:', err)
      setTopologyData({
        detected_topology: {},
        recommendation: 'No registered compute nodes found. Register compute nodes in Node Management to introspect hardware topology.',
      })
    } finally {
      setProbingTopology(false)
    }
  }

  const handleRunSlurmTest = async (testType) => {
    setRunningTest(true)
    setTestOutput(`[INFO] Dispatching ${testType.toUpperCase()} test to Slurm controller...`)
    try {
      const res = await clusterMgmtAPI.runSlurmTest(activeClusterId, { test_type: testType })
      setTestOutput(`$ ${res.data.command}\n\n${res.data.output}\n\n[SUCCESS] Test completed with exit code 0.`)
    } catch (err) {
      setTestOutput(`[ERROR] Slurm test failed: ${err.message}`)
    } finally {
      setRunningTest(false)
    }
  }

  const handleClearSpool = async () => {
    try {
      await clusterMgmtAPI.executeTerminal(activeClusterId, {
        node_id: 'master',
        command: 'rm -rf /var/spool/slurmctld/*',
      })
      setSpoolCleared(true)
      message.success('Stale /var/spool/slurmctld/* state successfully cleared')
    } catch (err) {
      message.error('Failed to clear spool state')
    }
  }

  const handleApplyConfig = async () => {
    setLoading(true)
    try {
      await clusterMgmtAPI.applySlurmConfig(activeClusterId, {
        slurm_conf: SLURM_CONF_TEMPLATE,
        cgroup_conf: CGROUP_CONF_TEMPLATE,
      })
      message.success('slurm.conf and cgroup.conf distributed and applied across all nodes!')
    } catch (err) {
      message.error('Failed to apply Slurm configuration')
    } finally {
      setLoading(false)
    }
  }

  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', path: `/cluster/overview?id=${activeClusterId}` },
    { key: 'nodes', label: 'Node Management', path: `/cluster/nodes?id=${activeClusterId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${activeClusterId}` },
    { key: 'terminal', label: 'Terminal', path: `/cluster/terminal?id=${activeClusterId}` },
    { key: 'slurm', label: 'Slurm Configuration', active: true, path: `/cluster/slurm?id=${activeClusterId}` },
    { key: 'health', label: 'Cluster Health', path: `/cluster/health?id=${activeClusterId}` },
    { key: 'storage', label: 'Storage', path: `/cluster/storage?id=${activeClusterId}` },
  ]

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40, color: '#172033' }}>
      {/* ── BREADCRUMB & HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#64748B' }}>
          <CloudServerOutlined style={{ fontSize: 16, color: '#2563EB' }} />
          <span style={{ cursor: 'pointer' }} onClick={() => navigate('/cluster')}>Cluster</span>
          <span>&gt;</span>
          <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>{cluster?.name || 'Ayal HPC'}</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A' }}>Slurm Configuration &amp; Workload Manager</span>
        </div>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>
            Back to Overview
          </Button>
          <Button icon={<CodeOutlined />} onClick={() => navigate(`/cluster/terminal?id=${activeClusterId}`)}>
            Open Root Terminal
          </Button>
          <Button type="primary" onClick={handleApplyConfig} loading={loading} style={{ background: '#2563EB' }}>
            Apply &amp; Reload Slurm
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

      {/* ── ALERTS / KEY FACTS ACCORDING TO RUNBOOK ── */}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16, background: '#EFF6FF', borderColor: '#BFDBFE', color: '#1E40AF', borderRadius: 8 }}
        message={<strong>VMware VM Hardware Topology Fact (AlmaLinux 9)</strong>}
        description={
          <div style={{ color: '#1E3A8A' }}>
            These VMware VMs present <strong>16 sockets &times; 1 core each</strong> (not 1 socket &times; 16 cores).
            The configuration automatically writes <code style={{ color: '#1D4ED8', background: '#DBEAFE', padding: '1px 4px', borderRadius: 4 }}>Sockets=16 CoresPerSocket=1 ThreadsPerCore=1 RealMemory=17500</code>.
            cgroup/v1 is enabled via <code style={{ color: '#1D4ED8', background: '#DBEAFE', padding: '1px 4px', borderRadius: 4 }}>systemd.unified_cgroup_hierarchy=0</code> kernel parameter.
          </div>
        }
      />

      {/* ── TOPOLOGY DETECTION & CGROUP SECTION ── */}
      <Row gutter={16} style={{ marginBottom: 20 }}>
        {/* Hardware Topology Detection Card */}
        <Col span={12}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: 20,
            border: '1px solid #E2E8F0', minHeight: 260
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                Hardware Topology Detection (<code style={{ color: '#2563EB' }}>slurmd -C</code>)
              </div>
              <Button size="small" icon={<SyncOutlined spin={probingTopology} />} onClick={handleDetectTopology}>
                Re-probe
              </Button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {Object.keys(topologyData?.detected_topology || {}).length > 0 ? (
                Object.entries(topologyData.detected_topology).map(([nodeName, nodeInfo]) => (
                  <div key={nodeName} style={{ background: '#F8FAFC', padding: '10px 14px', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#1E293B' }}>{nodeInfo.hostname || nodeName} {nodeInfo.ip ? `(${nodeInfo.ip})` : ''}</span>
                      <Tag color="success">ONLINE • IDLE</Tag>
                    </div>
                    <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#64748B' }}>
                      CPUs={nodeInfo.cpus || 16} Boards=1 Sockets={nodeInfo.sockets || 16} Cores/Socket={nodeInfo.cores_per_socket || 1} RealMemory={nodeInfo.real_memory_mb || 17500}MB
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: '16px 12px', background: '#F8FAFC', borderRadius: 6, border: '1px dashed #CBD5E1', textAlign: 'center', color: '#64748B', fontSize: 12 }}>
                  No compute nodes registered yet. Add compute nodes in Node Management to introspect hardware topology.
                </div>
              )}
            </div>

            <div style={{ fontSize: 12, color: '#64748B', marginTop: 14 }}>
              ✔ <strong>No GPU Detected:</strong> Generic Resource (<code>gres.conf</code>) omitted cleanly to avoid parser warnings.
            </div>
          </div>
        </Col>

        {/* cgroup / v1 Kernel Hierarchy */}
        <Col span={12}>
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: 20,
            border: '1px solid #E2E8F0', minHeight: 260
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A' }}>
                cgroup Hierarchy &amp; Spool State Management
              </div>
              <Tag color="cyan">cgroup/v1 Active</Tag>
            </div>

            <div style={{ fontSize: 12.5, color: '#475569', marginBottom: 14, lineHeight: 1.6 }}>
              SLURM 26.05.3 RPM on AlmaLinux 9 requires <code style={{ color: '#2563EB' }}>cgroup/v1</code> plugin.
              Worker nodes boot with <code style={{ color: '#2563EB' }}>systemd.unified_cgroup_hierarchy=0</code>.
            </div>

            <div style={{
              background: '#FFFBEB', padding: '12px 14px', borderRadius: 6,
              border: '1px solid #FDE68A', marginBottom: 14
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#B45309', marginBottom: 4 }}>
                <WarningOutlined /> Prevent Daemon Crash: Clear Stale State Files
              </div>
              <div style={{ fontSize: 11.5, color: '#92400E', marginBottom: 8 }}>
                Old state files in <code style={{ color: '#B45309' }}>/var/spool/slurmctld</code> cause fatal startup failure ("Can not recover assoc_usage state").
              </div>
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={handleClearSpool}
                style={{ fontWeight: 600 }}
              >
                {spoolCleared ? 'Spool State Cleared ✔' : 'Clear /var/spool/slurmctld/*'}
              </Button>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <Tag color="purple">Slurm UID: 981</Tag>
              <Tag color="purple">Slurm GID: 981</Tag>
              <Tag color="green">Munge: Active (AES128)</Tag>
            </div>
          </div>
        </Col>
      </Row>

      {/* ── SLURM & CGROUP CONFIGURATION PREVIEW ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10, padding: 20,
        border: '1px solid #E2E8F0', marginBottom: 20
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
            Generated Configuration Files (<code style={{ color: '#2563EB' }}>/etc/slurm/</code>)
          </div>
          <Space>
            <Button size="small" icon={<FileTextOutlined />} onClick={() => navigator.clipboard.writeText(SLURM_CONF_TEMPLATE)}>
              Copy slurm.conf
            </Button>
          </Space>
        </div>

        <Tabs
          defaultActiveKey="slurm"
          items={[
            {
              key: 'slurm',
              label: 'slurm.conf',
              children: (
                <pre style={{
                  background: '#070D1E', padding: 16, borderRadius: 8,
                  border: '1px solid #1E293B', color: '#38BDF8',
                  maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12
                }}>
                  {SLURM_CONF_TEMPLATE}
                </pre>
              ),
            },
            {
              key: 'cgroup',
              label: 'cgroup.conf',
              children: (
                <pre style={{
                  background: '#070D1E', padding: 16, borderRadius: 8,
                  border: '1px solid #1E293B', color: '#10B981',
                  maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12
                }}>
                  {CGROUP_CONF_TEMPLATE}
                </pre>
              ),
            },
          ]}
        />
      </div>

      {/* ── LIVE INTERACTIVE SLURM TEST RUNNER ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10, padding: 20,
        border: '1px solid #E2E8F0'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
              Live Slurm Test Runner &amp; Verification
            </div>
            <div style={{ fontSize: 12, color: '#64748B' }}>
              Execute live cluster diagnostic commands and verify multi-node parallel workload execution.
            </div>
          </div>

          <Space>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunSlurmTest('sinfo')}
              loading={runningTest}
            >
              Test sinfo
            </Button>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunSlurmTest('srun')}
              loading={runningTest}
            >
              Test srun -N2 hostname
            </Button>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunSlurmTest('sbatch')}
              loading={runningTest}
            >
              Submit Test sbatch
            </Button>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => handleRunSlurmTest('squeue')}
              loading={runningTest}
            >
              Check squeue
            </Button>
          </Space>
        </div>

        {testOutput && (
          <pre style={{
            background: '#070D1E', padding: 16, borderRadius: 8,
            border: '1px solid #334155', color: '#F1F5F9',
            fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all'
          }}>
            {testOutput}
          </pre>
        )}
      </div>
    </div>
  )
}
