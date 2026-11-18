import React from 'react'
/**
 * AjiCorehpc Manager — Graphical File Explorer
 * Full-featured file explorer supporting cluster nodes, NFS shares,
 * user directories, breadcrumb navigation, list/grid views, search,
 * drag-and-drop upload, streaming download, code preview, and POSIX ACL sharing.
 */
import { useState, useEffect } from 'react'
import {
  Card, Typography, Button, Table, Tag, Space, Modal, Form, Input,
  Upload, Checkbox, message, Popconfirm, Breadcrumb, Dropdown, Row, Col,
  Radio, Tooltip, Select, Descriptions, Spin, Divider
} from 'antd'
import {
  FolderOutlined, FileOutlined, ArrowUpOutlined, ReloadOutlined,
  UploadOutlined, DownloadOutlined, DeleteOutlined, EditOutlined,
  CopyOutlined, ScissorOutlined, EyeOutlined, InfoCircleOutlined,
  ShareAltOutlined, CloudServerOutlined, AppstoreOutlined,
  BarsOutlined, SearchOutlined, HddOutlined, PlusOutlined,
  FileTextOutlined, CodeOutlined
} from '@ant-design/icons'
import { filesAPI, nodesAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Dragger } = Upload
const { Option } = Select

export default function FileManagerPage() {
  const [selectedNode, setSelectedNode] = useState('')
  const [availableNodes, setAvailableNodes] = useState([])
  const [currentPath, setCurrentPath] = useState('/home')
  const [searchQuery, setSearchQuery] = useState('')
  const [items, setItems] = useState([])
  const [breadcrumbs, setBreadcrumbs] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('list') // 'list' or 'grid'
  const [selectedPaths, setSelectedPaths] = useState([])
  const [connectionError, setConnectionError] = useState(null)

  // Modals
  const [mkdirModalOpen, setMkdirModalOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameItemPath, setRenameItemPath] = useState('')
  const [renameNewName, setRenameNewName] = useState('')

  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  const [propertiesModalOpen, setPropertiesModalOpen] = useState(false)
  const [selectedItemForProps, setSelectedItemForProps] = useState(null)

  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareItemPath, setShareItemPath] = useState('')
  const [shareUser, setShareUser] = useState('tamil')
  const [sharePerm, setSharePerm] = useState('read')
  const [sharing, setSharing] = useState(false)

  const [clipboard, setClipboard] = useState(null) // { action: 'copy'|'move', sources: [...] }

  // Quick Bookmarks
  const bookmarks = [
    { label: 'Home Shared Storage', path: '/home', icon: '🏠' },
    { label: 'Scratch Workspace', path: '/scratch', icon: '⚡' },
    { label: 'Projects Storage', path: '/project', icon: '🔬' },
    { label: 'HPC Applications', path: '/apps', icon: '📦' },
    { label: 'Backup Repositories', path: '/backup', icon: '🛡️' },
  ]

  useEffect(() => {
    nodesAPI.list().then(res => {
      const data = res.data || []
      setAvailableNodes(data)
      if (data.length > 0) {
        const master = data.find(n => n.node_type === 'master') || data[0]
        setSelectedNode(master.address || master.management_ip || '')
      }
    }).catch(() => {})
  }, [])

  // Load directory items
  const loadDirectory = async (nodeIp = selectedNode, targetPath = currentPath, search = searchQuery) => {
    setLoading(true)
    setSelectedPaths([])
    setConnectionError(null)
    try {
      const res = await filesAPI.browse({
        node_ip: nodeIp,
        path: targetPath,
        search: search || undefined,
      })
      if (res.data?.connected === false) {
        setConnectionError({
          node_ip: res.data?.node_ip || nodeIp,
          error: res.data?.error || 'Node unreachable',
          error_code: res.data?.error_code || 'CONNECT_FAILED',
          guidance: res.data?.recovery_guidance || 'Check node network reachability and SSH configuration.',
        })
        setItems([])
        setBreadcrumbs(res.data?.breadcrumbs || [{ label: 'Root', path: '/' }])
      } else {
        setConnectionError(null)
        setItems(res.data?.items || [])
        setBreadcrumbs(res.data?.breadcrumbs || [])
        setCurrentPath(res.data?.current_path || targetPath)
      }
    } catch (err) {
      console.error(err)
      setConnectionError({
        node_ip: nodeIp,
        error: err.response?.data?.detail || err.message || 'Failed to read directory',
        error_code: 'API_ERROR',
        guidance: 'Check backend API service and network connectivity.',
      })
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDirectory(selectedNode, currentPath)
  }, [selectedNode, currentPath])

  // Navigation handlers
  const handleItemClick = (item) => {
    if (item.is_dir) {
      setCurrentPath(item.path)
    } else {
      handleOpenFilePreview(item.path)
    }
  }

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean)
    if (parts.length > 0) {
      parts.pop()
      const next = '/' + parts.join('/')
      setCurrentPath(next || '/')
    }
  }

  // File Operations
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return
    try {
      await filesAPI.mkdir({
        node_ip: selectedNode,
        parent_path: currentPath,
        folder_name: newFolderName.trim(),
      })
      message.success(`Folder '${newFolderName}' created`)
      setMkdirModalOpen(false)
      setNewFolderName('')
      loadDirectory()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to create directory')
    }
  }

  const handleRename = async () => {
    if (!renameNewName.trim()) return
    try {
      await filesAPI.rename({
        node_ip: selectedNode,
        old_path: renameItemPath,
        new_name: renameNewName.trim(),
      })
      message.success('Item renamed successfully')
      setRenameModalOpen(false)
      loadDirectory()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Rename failed')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedPaths.length === 0) return
    try {
      await filesAPI.delete({
        node_ip: selectedNode,
        paths: selectedPaths,
      })
      message.success(`Deleted ${selectedPaths.length} item(s)`)
      loadDirectory()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Delete failed')
    }
  }

  const handleDownload = (itemPath) => {
    const token = localStorage.getItem('token') || ''
    const url = `/api/files/download?node_ip=${selectedNode}&path=${encodeURIComponent(itemPath)}&token=${token}`
    const a = document.createElement('a')
    a.href = url
    a.download = itemPath.split('/').pop() || 'file'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const handleOpenFilePreview = async (filePath) => {
    setLoadingPreview(true)
    setPreviewModalOpen(true)
    try {
      const res = await filesAPI.preview({ node_ip: selectedNode, path: filePath })
      setPreviewData(res.data)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Failed to preview file')
      setPreviewModalOpen(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleShareSubmit = async () => {
    setSharing(true)
    try {
      await filesAPI.share({
        node_ip: selectedNode,
        path: shareItemPath,
        shared_with_type: 'user',
        shared_with_name: shareUser,
        permission: sharePerm,
      })
      message.success(`Shared '${shareItemPath}' with ${shareUser} (${sharePerm})`)
      setShareModalOpen(false)
    } catch (err) {
      message.error(err.response?.data?.detail || 'Sharing failed')
    } finally {
      setSharing(false)
    }
  }

  const handlePaste = async () => {
    if (!clipboard || !clipboard.sources?.length) return
    try {
      await filesAPI.copyMove({
        node_ip: selectedNode,
        sources: clipboard.sources,
        destination: currentPath,
        is_move: clipboard.action === 'move',
      })
      message.success(`${clipboard.action === 'move' ? 'Moved' : 'Copied'} items to ${currentPath}`)
      setClipboard(null)
      loadDirectory()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Paste operation failed')
    }
  }

  // Upload props
  const uploadProps = {
    name: 'file',
    multiple: true,
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        await filesAPI.upload(selectedNode, currentPath, file)
        message.success(`Uploaded ${file.name}`)
        onSuccess()
        loadDirectory()
      } catch (err) {
        message.error(`Failed to upload ${file.name}`)
        onError(err)
      }
    },
  }

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto' }}>
      {/* ── Top Header Toolbar ── */}
      <Card size="small" style={{ borderRadius: 8, marginBottom: 14, border: '1px solid #E2E8F0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          {/* Node Selector & Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#64748B' }}>NODE:</span>
            <Select
              value={selectedNode}
              onChange={setSelectedNode}
              style={{ width: 240 }}
              placeholder="Select node..."
            >
              {availableNodes.map(n => (
                <Option key={n.id || n.address} value={n.address || n.management_ip}>
                  <CloudServerOutlined style={{ color: n.node_type === 'master' ? '#2563EB' : '#16A34A', marginRight: 6 }} />
                  {n.hostname} ({n.address || n.management_ip})
                </Option>
              ))}
              {availableNodes.length === 0 && (
                <Option value="">Local Controller</Option>
              )}
            </Select>

            <Input
              prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
              placeholder="Search in current folder..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onPressEnter={() => loadDirectory(selectedNode, currentPath, searchQuery)}
              style={{ width: 240 }}
              allowClear
            />
          </div>

          {/* Action Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Button icon={<ArrowUpOutlined />} onClick={handleGoUp} disabled={currentPath === '/'}>
              Up
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => loadDirectory()} loading={loading}>
              Refresh
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setMkdirModalOpen(true)}>
              New Folder
            </Button>

            <Upload {...uploadProps}>
              <Button icon={<UploadOutlined />}>Upload</Button>
            </Upload>

            {clipboard && (
              <Button type="dashed" onClick={handlePaste}>
                Paste ({clipboard.sources.length} items)
              </Button>
            )}

            {selectedPaths.length > 0 && (
              <Space>
                <Button
                  icon={<CopyOutlined />}
                  onClick={() => setClipboard({ action: 'copy', sources: selectedPaths })}
                >
                  Copy ({selectedPaths.length})
                </Button>
                <Button
                  icon={<ScissorOutlined />}
                  onClick={() => setClipboard({ action: 'move', sources: selectedPaths })}
                >
                  Cut ({selectedPaths.length})
                </Button>
                <Popconfirm
                  title={`Delete ${selectedPaths.length} selected item(s)?`}
                  onConfirm={handleDeleteSelected}
                  okText="Yes, Delete"
                  cancelText="Cancel"
                  okButtonProps={{ danger: true }}
                >
                  <Button danger icon={<DeleteOutlined />}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            )}

            <Radio.Group value={viewMode} onChange={(e) => setViewMode(e.target.value)} size="middle">
              <Radio.Button value="list"><BarsOutlined /></Radio.Button>
              <Radio.Button value="grid"><AppstoreOutlined /></Radio.Button>
            </Radio.Group>
          </div>
        </div>

        {/* Breadcrumb Bar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, marginTop: 12,
          padding: '6px 12px', background: '#F8FAFC', borderRadius: 6, border: '1px solid #E2E8F0'
        }}>
          <span style={{ fontSize: 13, color: '#64748B' }}>📁</span>
          <Breadcrumb
            items={breadcrumbs.map((b, idx) => ({
              title: (
                <span
                  style={{
                    cursor: 'pointer',
                    fontWeight: idx === breadcrumbs.length - 1 ? 700 : 500,
                    color: idx === breadcrumbs.length - 1 ? '#0F172A' : '#2563EB',
                  }}
                  onClick={() => setCurrentPath(b.path)}
                >
                  {b.label}
                </span>
              ),
            }))}
          />
        </div>
      </Card>

      {/* ── Main Layout: Bookmarks Sidebar + File Explorer View ── */}
      <Row gutter={[16, 16]}>
        {/* Bookmarks Quick Access Sidebar */}
        <Col xs={24} md={5}>
          <Card size="small" title={<Text strong>Quick Locations</Text>} style={{ borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bookmarks.map((bm) => (
                <div
                  key={bm.path}
                  onClick={() => setCurrentPath(bm.path)}
                  style={{
                    padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                    background: currentPath === bm.path ? 'rgba(37,99,235,0.1)' : 'transparent',
                    color: currentPath === bm.path ? '#2563EB' : '#1E293B',
                    fontWeight: currentPath === bm.path ? 700 : 500,
                    fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{bm.icon}</span>
                  <span>{bm.label}</span>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        {/* Files Area */}
        <Col xs={24} md={19}>
          <Card size="small" style={{ borderRadius: 8, border: '1px solid #E2E8F0', minHeight: 480 }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 80 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <Spin size="large" />
                  <span style={{ color: '#64748B', fontSize: 13 }}>Loading files from cluster node...</span>
                </div>
              </div>
            ) : connectionError ? (
              <div style={{ textAlign: 'center', padding: '60px 20px', maxWidth: 540, margin: '0 auto' }}>
                <CloudServerOutlined style={{ fontSize: 48, color: '#EF4444', marginBottom: 16 }} />
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
                  Unable to Connect to Target Node ({connectionError.node_ip || 'No Node Selected'})
                </div>
                <div style={{ fontSize: 13, color: '#DC2626', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '10px 14px', marginBottom: 16 }}>
                  {connectionError.error}
                </div>
                <div style={{ fontSize: 12, color: '#475569', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 6, padding: '12px 14px', textAlign: 'left', marginBottom: 20, lineHeight: 1.6 }}>
                  <strong style={{ color: '#0F172A' }}>Recovery Guidance:</strong>
                  <div>{connectionError.guidance}</div>
                </div>
                <Space>
                  <Button type="primary" icon={<ReloadOutlined />} onClick={() => loadDirectory()} style={{ background: '#2563EB' }}>
                    Retry Connection
                  </Button>
                </Space>
              </div>
            ) : items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 80, color: '#94A3B8' }}>
                <FolderOutlined style={{ fontSize: 48, marginBottom: 12, color: '#CBD5E1' }} />
                <div style={{ fontSize: 14 }}>This directory is empty</div>
              </div>
            ) : viewMode === 'list' ? (
              /* LIST VIEW */
              <Table
                size="small"
                pagination={false}
                dataSource={items}
                rowKey="path"
                rowSelection={{
                  selectedRowKeys: selectedPaths,
                  onChange: setSelectedPaths,
                }}
                columns={[
                  {
                    title: 'Name',
                    key: 'name',
                    render: (_, r) => (
                      <div
                        onClick={() => handleItemClick(r)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                      >
                        <span style={{ fontSize: 16 }}>{r.is_dir ? '📁' : '📄'}</span>
                        <Text strong={r.is_dir} style={{ color: r.is_dir ? '#1E293B' : '#334155' }}>
                          {r.name}
                        </Text>
                      </div>
                    ),
                  },
                  { title: 'Size', dataIndex: 'size_formatted', key: 'sz', width: 100 },
                  { title: 'Permissions', dataIndex: 'permissions', key: 'perms', width: 120, render: (p) => <Text code style={{ fontSize: 11 }}>{p}</Text> },
                  { title: 'Owner / Group', key: 'og', width: 120, render: (_, r) => `${r.uid}:${r.gid}` },
                  { title: 'Modified', dataIndex: 'modified', key: 'mod', width: 160, render: (m) => m ? new Date(m).toLocaleString() : '' },
                  {
                    title: 'Actions',
                    key: 'act',
                    width: 140,
                    render: (_, r) => (
                      <Space size="small">
                        {!r.is_dir && (
                          <Tooltip title="Preview / Edit">
                            <Button size="small" type="text" icon={<EyeOutlined />} onClick={() => handleOpenFilePreview(r.path)} />
                          </Tooltip>
                        )}
                        {!r.is_dir && (
                          <Tooltip title="Download">
                            <Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => handleDownload(r.path)} />
                          </Tooltip>
                        )}
                        <Tooltip title="Share with User/Group">
                          <Button size="small" type="text" icon={<ShareAltOutlined />} onClick={() => { setShareItemPath(r.path); setShareModalOpen(true) }} />
                        </Tooltip>
                        <Tooltip title="Rename">
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setRenameItemPath(r.path); setRenameNewName(r.name); setRenameModalOpen(true) }} />
                        </Tooltip>
                        <Tooltip title="Properties">
                          <Button size="small" type="text" icon={<InfoCircleOutlined />} onClick={() => { setSelectedItemForProps(r); setPropertiesModalOpen(true) }} />
                        </Tooltip>
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              /* GRID VIEW */
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 14 }}>
                {items.map((item) => {
                  const isSelected = selectedPaths.includes(item.path)
                  return (
                    <div
                      key={item.path}
                      onClick={(e) => {
                        if (e.ctrlKey || e.metaKey) {
                          setSelectedPaths(prev => isSelected ? prev.filter(p => p !== item.path) : [...prev, item.path])
                        } else {
                          handleItemClick(item)
                        }
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setSelectedItemForProps(item)
                        setPropertiesModalOpen(true)
                      }}
                      style={{
                        padding: 12, borderRadius: 8, textAlign: 'center', cursor: 'pointer',
                        background: isSelected ? 'rgba(37,99,235,0.12)' : '#F8FAFC',
                        border: isSelected ? '1px solid #2563EB' : '1px solid #E2E8F0',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <div style={{ fontSize: 36, marginBottom: 4 }}>
                        {item.is_dir ? '📁' : '📄'}
                      </div>
                      <div style={{
                        fontSize: 12, fontWeight: item.is_dir ? 700 : 500,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        color: '#0F172A',
                      }}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
                        {item.is_dir ? 'Folder' : item.size_formatted}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── CREATE FOLDER MODAL ── */}
      <Modal
        title="Create New Folder"
        open={mkdirModalOpen}
        onOk={handleCreateFolder}
        onCancel={() => setMkdirModalOpen(false)}
        okText="Create"
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Destination: <Text code>{currentPath}</Text></Text>
          <Input
            placeholder="Folder name (e.g. simulation_output)"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onPressEnter={handleCreateFolder}
            style={{ marginTop: 10 }}
            autoFocus
          />
        </div>
      </Modal>

      {/* ── RENAME MODAL ── */}
      <Modal
        title="Rename Item"
        open={renameModalOpen}
        onOk={handleRename}
        onCancel={() => setRenameModalOpen(false)}
        okText="Rename"
      >
        <div style={{ marginTop: 12 }}>
          <Text type="secondary">Current Path: <Text code>{renameItemPath}</Text></Text>
          <Input
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            onPressEnter={handleRename}
            style={{ marginTop: 10 }}
            autoFocus
          />
        </div>
      </Modal>

      {/* ── FILE PREVIEW MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#2563EB' }} />
            <span>{previewData?.filename || 'File Preview'}</span>
            <Tag color="blue">{previewData?.size_bytes ? `${(previewData.size_bytes / 1024).toFixed(1)} KB` : ''}</Tag>
          </div>
        }
        open={previewModalOpen}
        onCancel={() => setPreviewModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewModalOpen(false)}>Close</Button>,
          <Button key="dl" type="primary" icon={<DownloadOutlined />} onClick={() => previewData && handleDownload(previewData.path)}>
            Download
          </Button>
        ]}
        width={800}
      >
        {loadingPreview ? (
          <div style={{ textAlign: 'center', padding: 40 }}><div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}><Spin /><span style={{ color: "#64748B", fontSize: 12 }}>Reading file...</span></div></div>
        ) : (
          <div>
            <div style={{ fontSize: 11.5, color: '#64748B', marginBottom: 8 }}>
              Path: <Text code>{previewData?.path}</Text> | Permissions: <Text code>{previewData?.permissions}</Text> ({previewData?.owner}:{previewData?.group})
            </div>
            <div style={{
              background: '#0F172A', color: '#F8FAFC', padding: 14,
              borderRadius: 6, maxHeight: 420, overflowY: 'auto',
              fontFamily: 'Consolas, Monaco, monospace', fontSize: 12, lineHeight: 1.5,
              whiteSpace: 'pre-wrap'
            }}>
              {previewData?.content || '(Empty file)'}
            </div>
          </div>
        )}
      </Modal>

      {/* ── FILE PROPERTIES MODAL ── */}
      <Modal
        title="Item Properties"
        open={propertiesModalOpen}
        onCancel={() => setPropertiesModalOpen(false)}
        footer={<Button onClick={() => setPropertiesModalOpen(false)}>Close</Button>}
      >
        {selectedItemForProps && (
          <Descriptions bordered size="small" column={1} style={{ marginTop: 12 }}>
            <Descriptions.Item label="Name">{selectedItemForProps.name}</Descriptions.Item>
            <Descriptions.Item label="Type">{selectedItemForProps.is_dir ? 'Directory' : 'File'}</Descriptions.Item>
            <Descriptions.Item label="Path"><Text code>{selectedItemForProps.path}</Text></Descriptions.Item>
            <Descriptions.Item label="Size">{selectedItemForProps.size_formatted} ({selectedItemForProps.size} bytes)</Descriptions.Item>
            <Descriptions.Item label="POSIX Mode">{selectedItemForProps.permissions} ({selectedItemForProps.mode_octal})</Descriptions.Item>
            <Descriptions.Item label="Owner / Group">{selectedItemForProps.uid}:{selectedItemForProps.gid}</Descriptions.Item>
            <Descriptions.Item label="Last Modified">{selectedItemForProps.modified ? new Date(selectedItemForProps.modified).toLocaleString() : ''}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      {/* ── SHARE WITH USER/GROUP MODAL ── */}
      <Modal
        title="Share File / Folder with HPC Users"
        open={shareModalOpen}
        onOk={handleShareSubmit}
        onCancel={() => setShareModalOpen(false)}
        okText="Grant Access"
        confirmLoading={sharing}
      >
        <div style={{ marginTop: 12 }}>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            Grants POSIX ACL access permissions to the target user or group on the cluster filesystem.
          </Paragraph>
          <Form layout="vertical">
            <Form.Item label="Target Resource">
              <Input value={shareItemPath} disabled />
            </Form.Item>
            <Row gutter={16}>
              <Col span={14}>
                <Form.Item label="Share with User">
                  <Select value={shareUser} onChange={setShareUser}>
                    <Option value="tamil">tamil (UID 10001)</Option>
                    <Option value="testuser1">testuser1 (UID 10002)</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={10}>
                <Form.Item label="Access Level">
                  <Select value={sharePerm} onChange={setSharePerm}>
                    <Option value="read">Read Only (r-x)</Option>
                    <Option value="write">Read & Write (rwx)</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </div>
      </Modal>
    </div>
  )
}
