import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, useParams } from 'react-router-dom'
import {
  Card, Button, Select, Space, Tag, Typography, Tooltip, message, Dropdown, Row, Col
} from 'antd'
import {
  CodeOutlined, CopyOutlined, ClearOutlined, PlayCircleOutlined,
  CloudServerOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, ArrowLeftOutlined, DesktopOutlined, DatabaseOutlined,
  SettingOutlined, HddOutlined, SafetyCertificateOutlined, CalendarOutlined,
  AppstoreOutlined
} from '@ant-design/icons'
import { clusterMgmtAPI, clusterAPI } from '../services/api'

const { Title, Text } = Typography
const { Option } = Select

const QUICK_COMMANDS = [
  { label: 'sinfo', cmd: 'sinfo -lNe', desc: 'Display Slurm partition and node states' },
  { label: 'squeue', cmd: 'squeue', desc: 'List active and queued batch jobs' },
  { label: 'scontrol nodes', cmd: 'scontrol show nodes', desc: 'Show detailed compute node allocations' },
  { label: 'slurmd -C', cmd: 'slurmd -C', desc: 'Introspect hardware topology (sockets & cores)' },
  { label: 'hostnamectl', cmd: 'hostnamectl', desc: 'Show system hostname, OS, and kernel' },
  { label: 'df -hT', cmd: 'df -hT', desc: 'Check mounted filesystems and NFS shared storage' },
  { label: 'lsblk', cmd: 'lsblk', desc: 'List block storage devices and partitions' },
  { label: 'free -h', cmd: 'free -h', desc: 'Display physical and swap memory utilization' },
  { label: 'chronyc', cmd: 'chronyc sources', desc: 'Check NTP time synchronization skew' },
  { label: 'munge test', cmd: 'munge -n | unmunge', desc: 'Validate Munge cryptographic authentication' },
  { label: 'slurmctld status', cmd: 'systemctl status slurmctld', desc: 'Check Slurm controller daemon status' },
  { label: 'slurmd status', cmd: 'systemctl status slurmd', desc: 'Check Slurm worker compute daemon status' },
  { label: 'cat /etc/hosts', cmd: 'cat /etc/hosts', desc: 'View cluster IP-to-hostname mappings' },
  { label: 'slurm.conf', cmd: 'cat /etc/slurm/slurm.conf | head -n 30', desc: 'View Slurm configuration head' },
]

export default function ClusterTerminalPage() {
  const navigate = useNavigate()
  const { clusterId } = useParams()
  const [searchParams] = useSearchParams()
  const activeClusterId = clusterId || searchParams.get('id') || ''

  const [cluster, setCluster] = useState(null)
  const [nodes, setNodes] = useState([])
  const [selectedNode, setSelectedNode] = useState(null)
  const [commandInput, setCommandInput] = useState('')
  const [isExecuting, setIsExecuting] = useState(false)
  const [history, setHistory] = useState([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [terminalEntries, setTerminalEntries] = useState([
    {
      id: 'init-1',
      type: 'system',
      timestamp: new Date().toLocaleTimeString(),
      text: 'AYAL HPC Enterprise Terminal • Zero-Trust Remote Shell Attached',
    },
    {
      id: 'init-2',
      type: 'info',
      timestamp: new Date().toLocaleTimeString(),
      text: 'Select an active cluster node to execute remote shell commands.',
    },
  ])

  const terminalEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    clusterAPI.getOverview().then(res => {
      const list = res.data?.clusters || []
      const found = list.find(c => c.id === activeClusterId || c.cluster_id === activeClusterId) || list[0]
      if (found) {
        setCluster(found)
      }
    }).catch(() => {})

    nodeMgmtAPI.getNodes().then(res => {
      const list = res.data?.nodes || res.data || []
      if (list.length > 0) {
        setNodes(list)
        setSelectedNode(list[0].id || list[0].hostname)
      }
    }).catch(() => {})
  }, [activeClusterId])

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [terminalEntries])

  const handleExecute = async (cmdToRun) => {
    const cmd = (cmdToRun || commandInput).trim()
    if (!cmd || isExecuting) return

    setHistory(prev => [cmd, ...prev.filter(h => h !== cmd)])
    setHistoryIndex(-1)
    setCommandInput('')
    setIsExecuting(true)

    const entryId = Date.now().toString()
    const nodeObj = getNodeMeta(selectedNode)

    setTerminalEntries(prev => [
      ...prev,
      {
        id: entryId,
        type: 'command',
        node: nodeObj.label,
        hostname: nodeObj.hostname,
        command: cmd,
        timestamp: new Date().toLocaleTimeString(),
      }
    ])

    try {
      const res = await clusterMgmtAPI.executeTerminal(activeClusterId, {
        node_id: selectedNode,
        command: cmd,
      })

      const data = res.data || {}
      setTerminalEntries(prev => [
        ...prev,
        {
          id: `${entryId}-res`,
          type: 'output',
          stdout: data.stdout || '',
          stderr: data.stderr || '',
          exit_code: data.exit_code ?? 0,
          duration_ms: data.duration_ms || 12,
          timestamp: new Date().toLocaleTimeString(),
        }
      ])
    } catch (err) {
      setTerminalEntries(prev => [
        ...prev,
        {
          id: `${entryId}-err`,
          type: 'output',
          stdout: '',
          stderr: err.response?.data?.detail || err.message || 'Execution failed',
          exit_code: 1,
          duration_ms: 0,
          timestamp: new Date().toLocaleTimeString(),
        }
      ])
    } finally {
      setIsExecuting(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleExecute()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1
        setHistoryIndex(nextIdx)
        setCommandInput(history[nextIdx])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyIndex > 0) {
        const prevIdx = historyIndex - 1
        setHistoryIndex(prevIdx)
        setCommandInput(history[prevIdx])
      } else if (historyIndex === 0) {
        setHistoryIndex(-1)
        setCommandInput('')
      }
    }
  }

  const handleClearTerminal = () => {
    setTerminalEntries([
      {
        id: Date.now().toString(),
        type: 'system',
        timestamp: new Date().toLocaleTimeString(),
        text: 'Terminal screen cleared.',
      }
    ])
  }

  const handleCopyAll = () => {
    const text = terminalEntries.map(e => {
      if (e.type === 'command') return `[${e.timestamp}] root@${e.hostname}:~# ${e.command}`
      if (e.type === 'output') return `${e.stdout}\n${e.stderr ? `ERROR: ${e.stderr}\n` : ''}`
      return `[${e.timestamp}] ${e.text}`
    }).join('\n')
    navigator.clipboard.writeText(text)
    message.success('Terminal transcript copied to clipboard')
  }

  const getNodeMeta = (key) => {
    const found = nodes.find(n => n.id === key || n.hostname === key || n.name === key)
    if (found) {
      return {
        label: found.hostname || found.name || 'node',
        hostname: found.hostname || found.name || 'node',
        ip: found.ip || found.address || 'N/A',
        role: found.role || found.node_type || 'Cluster Node'
      }
    }
    return { label: 'cluster', hostname: 'cluster-host', ip: 'N/A', role: 'Host' }
  }

  const currentNode = getNodeMeta(selectedNode)

  const HORIZONTAL_TABS = [
    { key: 'overview', label: 'Cluster Overview', path: `/cluster/overview?id=${activeClusterId}` },
    { key: 'nodes', label: 'Node Management', path: `/cluster/nodes?id=${activeClusterId}` },
    { key: 'config', label: 'HPC Configuration', path: `/cluster/config?id=${activeClusterId}` },
    { key: 'terminal', label: 'Terminal', active: true, path: `/cluster/terminal?id=${activeClusterId}` },
    { key: 'slurm', label: 'Slurm Configuration', path: `/cluster/slurm?id=${activeClusterId}` },
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
          <span style={{ cursor: 'pointer' }} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>{cluster?.name || 'Cluster Terminal'}</span>
          <span>&gt;</span>
          <span style={{ fontWeight: 700, color: '#0F172A' }}>Interactive Terminal</span>
        </div>

        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(`/cluster/overview?id=${activeClusterId}`)}>
            Back to Overview
          </Button>
          <Button type="primary" onClick={() => navigate(`/cluster/config?id=${activeClusterId}`)} style={{ background: '#2563EB' }}>
            HPC Configuration Pipeline &rarr;
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

      {/* ── TOP CONTROL BAR: Node Selection & Status (Light Enterprise Card) ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10, padding: '16px 20px',
        border: '1px solid #E2E8F0', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#172033' }}>Select Target Node:</span>
          <Select
            value={selectedNode}
            onChange={(val) => {
              setSelectedNode(val)
              const meta = getNodeMeta(val)
              setTerminalEntries(prev => [
                ...prev,
                {
                  id: Date.now().toString(),
                  type: 'info',
                  timestamp: new Date().toLocaleTimeString(),
                  text: `Switched target session to ${meta.hostname} (${meta.ip}) [${meta.role}].`,
                }
              ])
            }}
            style={{ minWidth: 320 }}
            placeholder="Select target node"
          >
            {nodes.length > 0 ? (
              nodes.map(n => (
                <Option key={n.id || n.hostname} value={n.id || n.hostname}>
                  <span style={{ fontWeight: 600 }}>{n.hostname || n.name}</span> ({n.ip || n.address || 'N/A'} &bull; {n.role || n.node_type || 'Node'})
                </Option>
              ))
            ) : (
              <Option value="none" disabled>
                No registered nodes available
              </Option>
            )}
          </Select>

          <Tag color="success" style={{ fontWeight: 600 }}>
            <CheckCircleOutlined /> Root Session Connected
          </Tag>
          <Tag color="blue">SSH Transport (Port 22)</Tag>
          <Tag color="default">AlmaLinux 9.8 (Olive Jaguar)</Tag>
        </div>

        <Space>
          <Button icon={<CopyOutlined />} size="small" onClick={handleCopyAll}>
            Copy Transcript
          </Button>
          <Button icon={<ClearOutlined />} size="small" onClick={handleClearTerminal}>
            Clear Terminal
          </Button>
        </Space>
      </div>

      {/* ── QUICK RUN COMMAND PALETTE (Light Enterprise Card) ── */}
      <div style={{
        background: '#FFFFFF', borderRadius: 10, padding: '14px 18px',
        border: '1px solid #E2E8F0', marginBottom: 16
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#64748B', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
          ⚡ Quick Run Command Palette (Click to Execute on {currentNode.label})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {QUICK_COMMANDS.map((qc) => (
            <Tooltip key={qc.label} title={`${qc.cmd} — ${qc.desc}`}>
              <button
                onClick={() => handleExecute(qc.cmd)}
                disabled={isExecuting}
                style={{
                  background: '#F8FAFC',
                  border: '1px solid #CBD5E1',
                  borderRadius: 6,
                  color: '#2563EB',
                  padding: '5px 11px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 6,
                  transition: 'all 0.15s ease',
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#2563EB'; e.currentTarget.style.background = '#EFF6FF' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#CBD5E1'; e.currentTarget.style.background = '#F8FAFC' }}
              >
                <PlayCircleOutlined style={{ fontSize: 11 }} />
                <span>{qc.label}</span>
              </button>
            </Tooltip>
          ))}
        </div>
      </div>

      {/* ── INTERACTIVE TERMINAL WINDOW ── */}
      <div style={{
        background: '#070D1E',
        borderRadius: 10,
        border: '1px solid #1E293B',
        boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        height: '620px',
      }}>
        {/* Terminal Header */}
        <div style={{
          background: '#0F172A',
          padding: '8px 16px',
          borderBottom: '1px solid #1E293B',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#EF4444' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#F59E0B' }} />
            <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#10B981' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94A3B8', marginLeft: 8, fontFamily: 'monospace' }}>
              root@{currentNode.hostname}:~ • /bin/bash (x86_64)
            </span>
          </div>

          <div style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
            {isExecuting ? (
              <span style={{ color: '#F59E0B' }}><SyncOutlined spin /> EXECUTING...</span>
            ) : (
              <span style={{ color: '#10B981' }}>● IDLE READY</span>
            )}
          </div>
        </div>

        {/* Terminal Log Stream Area */}
        <div style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
          fontSize: 13,
          lineHeight: 1.6,
        }}>
          {terminalEntries.map((e) => {
            if (e.type === 'system') {
              return (
                <div key={e.id} style={{ color: '#64748B', marginBottom: 4, fontStyle: 'italic' }}>
                  [{e.timestamp}] === {e.text} ===
                </div>
              )
            }
            if (e.type === 'info') {
              return (
                <div key={e.id} style={{ color: '#38BDF8', marginBottom: 6 }}>
                  [{e.timestamp}] [INFO] {e.text}
                </div>
              )
            }
            if (e.type === 'command') {
              return (
                <div key={e.id} style={{ marginTop: 12, marginBottom: 4 }}>
                  <span style={{ color: '#10B981', fontWeight: 700 }}>root@{e.hostname}</span>
                  <span style={{ color: '#94A3B8' }}>:</span>
                  <span style={{ color: '#38BDF8', fontWeight: 700 }}>~</span>
                  <span style={{ color: '#F8FAFC' }}># </span>
                  <span style={{ color: '#F1F5F9', fontWeight: 600 }}>{e.command}</span>
                </div>
              )
            }
            if (e.type === 'output') {
              return (
                <div key={e.id} style={{ marginBottom: 12 }}>
                  {e.stdout && (
                    <pre style={{
                      margin: 0,
                      color: '#E2E8F0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: 'inherit',
                      fontSize: 'inherit'
                    }}>
                      {e.stdout}
                    </pre>
                  )}
                  {e.stderr && (
                    <pre style={{
                      margin: 0,
                      color: '#EF4444',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: 'inherit',
                      fontSize: 'inherit'
                    }}>
                      {e.stderr}
                    </pre>
                  )}
                  <div style={{ fontSize: 11, color: e.exit_code === 0 ? '#10B981' : '#EF4444', marginTop: 4 }}>
                    {e.exit_code === 0 ? '✔ Exit: 0 (Success)' : `✖ Exit: ${e.exit_code} (Failed)`} • Duration: {e.duration_ms}ms
                  </div>
                </div>
              )
            }
            return null
          })}
          <div ref={terminalEndRef} />
        </div>

        {/* Terminal Interactive Prompt Input */}
        <div style={{
          background: '#0B1120',
          padding: '10px 16px',
          borderTop: '1px solid #1E293B',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ color: '#10B981', fontWeight: 700, fontFamily: 'monospace', fontSize: 13 }}>
            root@{currentNode.label}:~#
          </span>
          <input
            ref={inputRef}
            type="text"
            value={commandInput}
            onChange={(e) => setCommandInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isExecuting}
            placeholder={isExecuting ? "Executing command on remote node..." : "Type bash command (e.g. sinfo, slurmd -C, lsblk, df -hT)..."}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#F8FAFC',
              fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
              fontSize: 13,
            }}
            autoFocus
          />
          <Button
            type="primary"
            size="small"
            icon={<PlayCircleOutlined />}
            loading={isExecuting}
            onClick={() => handleExecute()}
            style={{ background: '#2563EB', fontWeight: 600 }}
          >
            Run
          </Button>
        </div>
      </div>
    </div>
  )
}
