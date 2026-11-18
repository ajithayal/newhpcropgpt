import React, { useState, useEffect } from 'react'
import {
  Steps, Card, Button, Form, Input, Select, Table, Tag,
  Alert, Space, Typography, Row, Col, Tooltip, message, Radio
} from 'antd'
import {
  HddOutlined, ShareAltOutlined, TeamOutlined, CloudServerOutlined,
  CheckCircleOutlined, ExclamationCircleOutlined, LoadingOutlined,
  SyncOutlined, ReloadOutlined, FolderOpenOutlined, AppstoreOutlined,
  UserOutlined, ThunderboltOutlined, SafetyCertificateOutlined
} from '@ant-design/icons'
import api from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function AppsStorageWizard() {
  const [currentStep, setCurrentStep] = useState(0)
  const [loadingDisks, setLoadingDisks] = useState(false)
  const [disks, setDisks] = useState([])
  const [selectedDisk, setSelectedDisk] = useState(null)
  const [confirmWipeInput, setConfirmWipeInput] = useState('')

  // Target Storage Path & Filesystem
  const [targetStorage, setTargetStorage] = useState('/apps')
  const [customPath, setCustomPath] = useState('/data')
  const [fsType, setFsType] = useState('xfs')

  const effectiveMountPoint = targetStorage === 'custom' ? customPath : targetStorage

  const [masterHost, setMasterHost] = useState('')
  const [executing, setExecuting] = useState(false)
  const [logs, setLogs] = useState([])
  const [stepResult, setStepResult] = useState(null)

  // Step 2 state: NFS Share
  const [subnet, setSubnet] = useState('*')
  const [exportOptions, setExportOptions] = useState('rw,sync,no_root_squash,no_subtree_check')

  // Step 3 state: User/Group
  const [accessGroup, setAccessGroup] = useState('researchers')
  const [accessPerm, setAccessPerm] = useState('r-x')

  // Step 4 state: Node automount
  const [statusOverview, setStatusOverview] = useState(null)

  useEffect(() => {
    loadMasterDisks()
    loadAppsStatus()
  }, [])

  const loadMasterDisks = async () => {
    setLoadingDisks(true)
    try {
      const res = await api.get('/apps/disks')
      const devList = res.data?.blockdevices || []
      setDisks(devList)
      if (res.data?.master_host) setMasterHost(res.data.master_host)

      // Auto-select unallocated disk (like sdb) if available
      const unallocated = devList.find(d => !d.mountpoint && (!d.children || d.children.length === 0) && d.name !== 'sda')
      if (unallocated) {
        setSelectedDisk(unallocated)
      } else if (devList.length > 0) {
        setSelectedDisk(devList[0])
      }
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to inspect master disks')
    } finally {
      setLoadingDisks(false)
    }
  }

  const loadAppsStatus = async () => {
    try {
      const res = await api.get('/apps/status')
      setStatusOverview(res.data)
    } catch (err) {}
  }

  // 1. Step 1: Create Storage (Apps / Home / Scratch)
  const handleCreateStorage = async () => {
    if (!selectedDisk) {
      message.warning('Please select a disk device')
      return
    }
    setExecuting(true)
    const devPath = selectedDisk.path || `/dev/${selectedDisk.name}`
    setLogs([
      `[INIT] Starting storage provisioning on master controller (${masterHost})...`,
      `[INFO] Target Device: ${devPath} (${selectedDisk.size})`,
      `[INFO] Mount Target: ${effectiveMountPoint}`,
      `[INFO] Filesystem: ${fsType.toUpperCase()} (with user & project quota accounting)`,
      `[INFO] Formatting device and writing persistent entry into /etc/fstab...`
    ])

    try {
      const res = await api.post('/apps/create', {
        device: devPath,
        confirm_wipe: confirmWipeInput,
        mount_point: effectiveMountPoint,
        fs_type: fsType,
      })
      setStepResult(res.data)
      setLogs((prev) => [
        ...prev,
        `[SUCCESS] ${res.data.summary_message || `Storage created and mounted to ${effectiveMountPoint}`}`,
        `[SUCCESS] Directory hierarchy initialized and validated with findmnt ${effectiveMountPoint}.`
      ])
      message.success(`Storage partition successfully created and mounted to ${effectiveMountPoint}`)
      loadAppsStatus()
      setCurrentStep(1)
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message
      setLogs((prev) => [...prev, `[ERROR] Storage creation failed: ${errMsg}`])
      message.error(errMsg)
    } finally {
      setExecuting(false)
    }
  }

  // 2. Step 2: NFS Share
  const handleShareNfs = async () => {
    setExecuting(true)
    setLogs((prev) => [
      ...prev,
      `[INFO] Configuring NFS export for ${effectiveMountPoint} on master...`,
      `[INFO] Target Subnet: ${subnet} | Options: ${exportOptions}`,
      `[INFO] Updating /etc/exports.d/ and opening firewalld NFS ports (2049/tcp, 111/tcp)...`
    ])

    try {
      const res = await api.post('/apps/nfs/share', {
        path: effectiveMountPoint,
        subnet,
        export_options: exportOptions,
      })
      setStepResult(res.data)
      setLogs((prev) => [
        ...prev,
        `[SUCCESS] ${res.data.summary_message || `NFS export active for ${effectiveMountPoint}`}`,
        `[SUCCESS] Verified with exportfs -v.`
      ])
      message.success(`NFS export active for ${effectiveMountPoint}`)
      loadAppsStatus()
      setCurrentStep(2)
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message
      setLogs((prev) => [...prev, `[ERROR] NFS export configuration failed: ${errMsg}`])
      message.error(errMsg)
    } finally {
      setExecuting(false)
    }
  }

  // 3. Step 3: Permissions & Group
  const handleSetPermissions = async () => {
    setExecuting(true)
    setLogs((prev) => [
      ...prev,
      `[INFO] Applying POSIX permissions and default ACLs for group '${accessGroup}' on ${effectiveMountPoint}...`,
      `[INFO] Setting permission mode: ${accessPerm}...`
    ])

    try {
      const res = await api.post('/apps/permissions', {
        path: effectiveMountPoint,
        group_name: accessGroup,
        permissions: accessPerm,
      })
      setLogs((prev) => [
        ...prev,
        `[SUCCESS] ${res.data.message || 'Permissions verified.'}`,
        `[ACL] ${res.data.acl_report ? res.data.acl_report.split('\n')[0] : 'ACL rules active'}`
      ])
      message.success(`POSIX ACLs configured for ${accessGroup} on ${effectiveMountPoint}`)
      loadAppsStatus()
      setCurrentStep(3)
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message
      setLogs((prev) => [...prev, `[ERROR] ACL update failed: ${errMsg}`])
      message.error(errMsg)
    } finally {
      setExecuting(false)
    }
  }

  // 4. Step 4: Compute Node Mount
  const handleMountNodes = async () => {
    setExecuting(true)
    setLogs((prev) => [
      ...prev,
      `[INFO] Enqueuing ${effectiveMountPoint} NFS automount across all registered compute workers...`,
      `[INFO] Target Server: ${masterHost}:${effectiveMountPoint}`,
      `[INFO] Adding persistent entry to /etc/fstab with _netdev,nofail,x-systemd.automount...`
    ])

    try {
      const res = await api.post('/apps/nodes/mount', {
        mount_point: effectiveMountPoint,
        server_path: effectiveMountPoint,
      })
      setStepResult(res.data)
      setLogs((prev) => [
        ...prev,
        `[SUCCESS] Automount enqueued across compute workers.`,
        `[SUCCESS] Workers will auto-mount ${effectiveMountPoint} on boot or reconnect.`
      ])
      message.success(`Automount successfully configured for ${effectiveMountPoint}`)
      loadAppsStatus()
    } catch (err) {
      const errMsg = err.response?.data?.detail || err.message
      setLogs((prev) => [...prev, `[ERROR] Node mount failed: ${errMsg}`])
      message.error(errMsg)
    } finally {
      setExecuting(false)
    }
  }

  const diskColumns = [
    {
      title: 'Device',
      dataIndex: 'name',
      key: 'name',
      render: (n, r) => (
        <Space>
          <HddOutlined style={{ color: '#2563EB', fontSize: 16 }} />
          <strong>{r.path || `/dev/${n}`}</strong>
          {r.model && <Text type="secondary" style={{ fontSize: 11 }}>({r.model})</Text>}
        </Space>
      ),
    },
    { title: 'Size', dataIndex: 'size', key: 'size', width: 90, render: (s) => <Tag color="geekblue">{s}</Tag> },
    { title: 'Type', dataIndex: 'type', key: 'type', width: 80 },
    {
      title: 'Filesystem / State',
      dataIndex: 'fstype',
      key: 'fstype',
      render: (f, r) => {
        if (r.children && r.children.length > 0) return <Tag color="cyan">Has Partitions ({r.children.length})</Tag>
        return f ? <Tag color="blue">{f}</Tag> : <Tag color="green">Raw / Unallocated</Tag>
      },
    },
    {
      title: 'Mountpoint',
      dataIndex: 'mountpoint',
      key: 'mountpoint',
      render: (m, r) => {
        if (m) return <Tag color="orange">{m}</Tag>
        if (r.children?.some(c => c.mountpoint === '/')) return <Tag color="red">OS Root Disk</Tag>
        return <Tag color="success">Free for Cluster</Tag>
      },
    },
    {
      title: 'Action',
      key: 'act',
      width: 120,
      render: (_, r) => {
        const isSelected = selectedDisk?.name === r.name
        const isRootMounted = r.mountpoint === '/' || r.mountpoint === '/boot' || r.children?.some(c => c.mountpoint === '/')
        return (
          <Button
            size="small"
            type={isSelected ? 'primary' : 'default'}
            disabled={isRootMounted}
            onClick={() => { setSelectedDisk(r); setConfirmWipeInput('') }}
            style={{ background: isSelected ? '#2563EB' : undefined }}
          >
            {isSelected ? 'Selected' : 'Choose Disk'}
          </Button>
        )
      },
    },
  ]

  const STORAGE_TARGET_CARDS = [
    {
      key: '/apps',
      title: '/apps — Central Applications & Spack',
      icon: <AppstoreOutlined style={{ fontSize: 20, color: '#2563EB' }} />,
      desc: 'Central software repository, Spack packages, Lmod environment modules, GCC/LLVM compilers, and shared MPI libraries.',
      hierarchy: '/apps/spack, /apps/modules, /apps/compilers, /apps/libraries, /apps/applications, /apps/software'
    },
    {
      key: '/home',
      title: '/home — Central User Directories',
      icon: <UserOutlined style={{ fontSize: 20, color: '#10B981' }} />,
      desc: 'Multi-tenant user home directories with FreeIPA SSSD synchronization, strict POSIX isolation (0700), and disk quotas.',
      hierarchy: '/home/{user1}, /home/{user2}, ...'
    },
    {
      key: '/scratch',
      title: '/scratch — High-Speed Work Storage',
      icon: <ThunderboltOutlined style={{ fontSize: 20, color: '#F59E0B' }} />,
      desc: 'High-throughput temporary scratch area for active Slurm job calculation I/O with 1777 sticky bit permissions.',
      hierarchy: '/scratch/{job_id}, /scratch/{user}/...'
    },
    {
      key: 'custom',
      title: 'Custom Mount Path',
      icon: <FolderOpenOutlined style={{ fontSize: 20, color: '#8B5CF6' }} />,
      desc: 'Define a custom storage mount point (e.g. /data, /shared, /dataset) with configurable permissions and quotas.',
      hierarchy: 'Custom user-specified path'
    }
  ]

  return (
    <div style={{ maxWidth: 1250, margin: '0 auto', padding: '10px 0 40px 0' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <Title level={4} style={{ margin: 0, fontWeight: 800, color: '#0F172A' }}>
              Centralized HPC Storage, Partitioning & NFS Automation
            </Title>
            <Paragraph type="secondary" style={{ fontSize: 13, margin: '4px 0 0 0' }}>
              Create and mount dedicated storage partitions for <strong>/apps</strong>, <strong>/home</strong>, and <strong>/scratch</strong>, export via NFS, configure POSIX permissions & quotas, and automount across compute workers.
            </Paragraph>
          </div>
          <Button onClick={loadMasterDisks} icon={<ReloadOutlined />}>
            Refresh Master Disks
          </Button>
        </div>
      </div>

      <Steps
        current={currentStep}
        onChange={setCurrentStep}
        style={{ marginBottom: 24 }}
        items={[
          { title: `1. Partition & Mount (${effectiveMountPoint})`, icon: <HddOutlined /> },
          { title: `2. NFS Export (${effectiveMountPoint})`, icon: <ShareAltOutlined /> },
          { title: '3. POSIX Permissions & ACLs', icon: <TeamOutlined /> },
          { title: '4. Worker Node Automount', icon: <CloudServerOutlined /> },
        ]}
      />

      {/* ── STEP 0: STORAGE TARGET, DISK SELECT & CREATE ── */}
      {currentStep === 0 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <HddOutlined style={{ color: '#2563EB' }} />
              <span>Step 1: Select Storage Area, Device & Initialize Partition</span>
            </div>
          }
          variant="borderless"
          style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}
        >
          {/* Target Storage Selector Cards */}
          <div style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 13, color: '#1E293B', display: 'block', marginBottom: 10 }}>
              Select Dedicated Storage Area to Create on Master Controller:
            </Text>
            <Row gutter={[12, 12]}>
              {STORAGE_TARGET_CARDS.map((card) => {
                const isSelected = targetStorage === card.key
                return (
                  <Col xs={24} sm={12} md={6} key={card.key}>
                    <div
                      onClick={() => setTargetStorage(card.key)}
                      style={{
                        padding: '14px 16px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #2563EB' : '1px solid #E2E8F0',
                        background: isSelected ? '#EFF6FF' : '#FFFFFF',
                        transition: 'all 0.15s ease',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        {card.icon}
                        <strong style={{ fontSize: 13, color: isSelected ? '#1E40AF' : '#0F172A' }}>
                          {card.key === 'custom' ? 'Custom' : card.key}
                        </strong>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.4, flex: 1 }}>
                        {card.desc}
                      </div>
                      <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 8, fontFamily: 'monospace' }}>
                        Hierarchy: {card.hierarchy}
                      </div>
                    </div>
                  </Col>
                )
              })}
            </Row>

            {targetStorage === 'custom' && (
              <div style={{ marginTop: 12, padding: 12, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0' }}>
                <Text strong>Custom Mount Point:</Text>
                <Input
                  style={{ width: 260, marginLeft: 12 }}
                  placeholder="/data or /shared"
                  value={customPath}
                  onChange={(e) => setCustomPath(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Filesystem Selection */}
          <div style={{ marginBottom: 20, padding: '12px 16px', background: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <Row gutter={16} align="middle">
              <Col xs={24} sm={8}>
                <Text strong style={{ fontSize: 13 }}>Filesystem Type:</Text>
                <div style={{ marginTop: 4 }}>
                  <Radio.Group value={fsType} onChange={(e) => setFsType(e.target.value)}>
                    <Radio value="xfs"><strong>XFS</strong> (Recommended for HPC, User &amp; Project Quotas)</Radio>
                    <Radio value="ext4"><strong>Ext4</strong> (Standard Journaled)</Radio>
                  </Radio.Group>
                </div>
              </Col>
              <Col xs={24} sm={16}>
                <div style={{ fontSize: 12, color: '#64748B' }}>
                  Persistent mount will be configured in <code>/etc/fstab</code> using UUID with options: <code>defaults,nofail,{fsType === 'xfs' ? 'uquota,pquota' : 'usrquota,grpquota'}</code>.
                </div>
              </Col>
            </Row>
          </div>

          <Alert
            message="Master Controller Disk Protection Guard Active"
            description="AYAL HPC inspects block devices on the controller. System disks (/, /boot) are protected. Dedicated physical disks or NVMe storage pools are recommended for cluster workloads."
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          <Table
            columns={diskColumns}
            dataSource={disks}
            rowKey="name"
            loading={loadingDisks}
            pagination={false}
            size="small"
            style={{ marginBottom: 16 }}
          />

          {selectedDisk && (
            <div style={{ padding: 14, background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <Text strong>Selected Storage Device:</Text>{' '}
                  <code style={{ fontSize: 13, fontWeight: 700 }}>{selectedDisk.path || `/dev/${selectedDisk.name}`}</code> ({selectedDisk.size})
                  <span style={{ marginLeft: 12, color: '#2563EB', fontWeight: 600 }}>
                    &rarr; Mount Target: {effectiveMountPoint}
                  </span>
                </div>
                {(selectedDisk.fstype || selectedDisk.children) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text type="danger" strong style={{ fontSize: 12 }}>Device has existing data. Type device name to confirm wipe:</Text>
                    <Input
                      style={{ width: 140 }}
                      placeholder={selectedDisk.name}
                      value={confirmWipeInput}
                      onChange={(e) => setConfirmWipeInput(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          <Space>
            <Button
              type="primary"
              size="large"
              loading={executing}
              disabled={!selectedDisk}
              onClick={handleCreateStorage}
              style={{ background: '#2563EB' }}
            >
              Format &amp; Mount {effectiveMountPoint} Storage
            </Button>
            <Button size="large" onClick={() => setCurrentStep(1)}>
              Skip to NFS Export &rarr;
            </Button>
          </Space>
        </Card>
      )}

      {/* ── STEP 1: NFS SHARE ── */}
      {currentStep === 1 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ShareAltOutlined style={{ color: '#2563EB' }} />
              <span>Step 2: Export {effectiveMountPoint} via NFS Server on Master</span>
            </div>
          }
          variant="borderless"
          style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}
        >
          <Paragraph type="secondary">
            Configures <code>/etc/exports.d/ayalhpc-{effectiveMountPoint.replace(/\//g, '-').replace(/^-/, '')}.exports</code> on master controller ({masterHost}), opens firewall ports (2049/tcp, 111/tcp), runs <code>exportfs -ra</code>, and verifies with <code>exportfs -v</code>.
          </Paragraph>

          <Row gutter={16} style={{ maxWidth: 640, marginBottom: 16 }}>
            <Col span={24}>
              <Text strong>Target Path to Export:</Text>
              <Input value={effectiveMountPoint} disabled style={{ marginTop: 4, marginBottom: 12, fontWeight: 700 }} />
            </Col>
            <Col span={24}>
              <Text strong>Allowed Subnet / Target Compute Nodes:</Text>
              <Input
                value={subnet}
                onChange={(e) => setSubnet(e.target.value)}
                placeholder="Subnet (e.g., 10.0.0.0/24 or *)"
                style={{ marginTop: 4, marginBottom: 12 }}
              />
            </Col>
            <Col span={24}>
              <Text strong>NFS Export Options:</Text>
              <Input
                value={exportOptions}
                onChange={(e) => setExportOptions(e.target.value)}
                style={{ marginTop: 4, marginBottom: 12 }}
              />
            </Col>
          </Row>

          <Space>
            <Button type="primary" size="large" loading={executing} onClick={handleShareNfs} style={{ background: '#2563EB' }}>
              Export {effectiveMountPoint} &amp; Open Firewall
            </Button>
            <Button size="large" onClick={() => setCurrentStep(2)}>
              Skip to Permissions &rarr;
            </Button>
          </Space>
        </Card>
      )}

      {/* ── STEP 2: USER / GROUP ACCESS ── */}
      {currentStep === 2 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <TeamOutlined style={{ color: '#2563EB' }} />
              <span>Step 3: User &amp; Group Access Permissions (POSIX &amp; ACL) on {effectiveMountPoint}</span>
            </div>
          }
          variant="borderless"
          style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}
        >
          <Paragraph type="secondary">
            Sets POSIX group permissions and default ACLs (<code>setfacl</code>) on {effectiveMountPoint} to guarantee appropriate researcher and administrator access policies.
          </Paragraph>

          <Row gutter={16} style={{ maxWidth: 600, marginBottom: 16 }}>
            <Col span={12}>
              <Text strong>Target POSIX Group:</Text>
              <Input value={accessGroup} onChange={(e) => setAccessGroup(e.target.value)} style={{ marginTop: 4, marginBottom: 12 }} />
            </Col>
            <Col span={12}>
              <Text strong>Permissions (POSIX ACL):</Text>
              <Select value={accessPerm} onChange={setAccessPerm} style={{ width: '100%', marginTop: 4, marginBottom: 12 }}>
                <Option value="r-x">Read &amp; Execute (r-x) — Researchers / Batch Jobs</Option>
                <Option value="rwx">Read, Write &amp; Execute (rwx) — Admins &amp; Shared</Option>
              </Select>
            </Col>
          </Row>

          <Space>
            <Button type="primary" size="large" loading={executing} onClick={handleSetPermissions} style={{ background: '#2563EB' }}>
              Apply &amp; Verify ACLs on {effectiveMountPoint}
            </Button>
            <Button size="large" onClick={() => setCurrentStep(3)}>
              Skip to Node Automount &rarr;
            </Button>
          </Space>
        </Card>
      )}

      {/* ── STEP 3: NODE AUTOMOUNT ── */}
      {currentStep === 3 && (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CloudServerOutlined style={{ color: '#2563EB' }} />
              <span>Step 4: Compute Worker Node Automount ({effectiveMountPoint})</span>
            </div>
          }
          variant="borderless"
          style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}
        >
          <Paragraph type="secondary">
            Enqueues <code>{masterHost}:{effectiveMountPoint}</code> in <code>/etc/fstab</code> on compute worker nodes with options <code>nfs4 _netdev,nofail,x-systemd.automount,bg,intr</code>. If a worker node is offline, the operation is queued and auto-applied immediately upon reconnect.
          </Paragraph>

          {statusOverview && (
            <div style={{ marginBottom: 16 }}>
              <Title level={5}>Live Storage Mount Status across Fleet:</Title>
              <Row gutter={[12, 12]}>
                {(statusOverview.nodes || []).map((n) => (
                  <Col span={12} key={n.host}>
                    <div style={{
                      padding: '10px 14px', borderRadius: 6,
                      background: n.mounted ? '#F0FDF4' : '#FFFBEB',
                      border: `1px solid ${n.mounted ? '#BBF7D0' : '#FDE68A'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                      <div>
                        <strong>{n.hostname || n.host}</strong> ({n.role})
                        <div style={{ fontSize: 11, color: '#64748B' }}>IP: {n.host}</div>
                      </div>
                      <Tag color={n.mounted ? 'green' : 'orange'}>
                        {n.mounted ? 'MOUNTED & VERIFIED' : 'PENDING MOUNT'}
                      </Tag>
                    </div>
                  </Col>
                ))}
              </Row>
            </div>
          )}

          <Space>
            <Button type="primary" size="large" loading={executing} onClick={handleMountNodes} style={{ background: '#2563EB' }}>
              Deploy {effectiveMountPoint} Automount Across Compute Nodes
            </Button>
            <Button size="large" onClick={loadAppsStatus} icon={<ReloadOutlined />}>
              Refresh Mount Status
            </Button>
          </Space>
        </Card>
      )}

      {/* ── TERMINAL EXECUTION LOGS ── */}
      {logs.length > 0 && (
        <Card size="small" title="Storage Automation Execution Console" style={{ marginTop: 16, border: '1px solid #E2E8F0', borderRadius: 8 }}>
          <pre style={{
            background: '#0F172A', color: '#E2E8F0', padding: 12, borderRadius: 6,
            maxHeight: 220, overflowY: 'auto', fontSize: 11.5, fontFamily: 'monospace', margin: 0
          }}>
            {logs.map((l, idx) => (
              <div key={idx} style={{ color: l.includes('ERROR') ? '#F87171' : l.includes('SUCCESS') ? '#4ADE80' : '#E2E8F0' }}>
                {l}
              </div>
            ))}
          </pre>
        </Card>
      )}
    </div>
  )
}
