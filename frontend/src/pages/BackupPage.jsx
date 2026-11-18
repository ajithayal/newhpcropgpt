import React from 'react'
import { useState, useEffect } from 'react'
import {
  Card, Typography, Button, Table, Tag, Space, Modal, Form, Input,
  Upload, Checkbox, message, Popconfirm, Progress, Alert, Tabs, Descriptions,
} from 'antd'
import {
  DownloadOutlined, UploadOutlined, DeleteOutlined, ReloadOutlined,
  CloudDownloadOutlined, SafetyCertificateOutlined, DatabaseOutlined,
  ClockCircleOutlined, InfoCircleOutlined, WarningOutlined,
} from '@ant-design/icons'
import api from '../services/api'

const { Title, Text } = Typography
const { Dragger } = Upload

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export default function BackupPage() {
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreFile, setRestoreFile] = useState(null)
  const [restoreOpts, setRestoreOpts] = useState({})
  const [activeTab, setActiveTab] = useState('list')

  useEffect(() => { loadBackups() }, [])

  const loadBackups = async () => {
    setLoading(true)
    try {
      const res = await api.get('/backups')
      setBackups(res.data.backups || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const createBackup = async () => {
    setCreating(true)
    try {
      const res = await api.post('/backups/create')
      message.success(res.data.message || 'Backup created')
      loadBackups()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Backup failed')
    } finally {
      setCreating(false)
    }
  }

  const deleteBackup = async (filename) => {
    try {
      await api.delete(`/backups/${filename}`)
      message.success('Deleted')
      loadBackups()
    } catch (err) {
      message.error(err.response?.data?.detail || 'Delete failed')
    }
  }

  const downloadBackup = (filename) => {
    const token = localStorage.getItem('token')
    const a = document.createElement('a')
    a.href = `/api/backups/${encodeURIComponent(filename)}/download?token=${token}`
    a.download = filename
    a.click()
  }

  const restoreBackup = async () => {
    if (!restoreFile) return
    setRestoring(true)
    try {
      const res = await api.post('/backups/restore', {
        filename: restoreFile,
        db_only: restoreOpts.db_only || false,
        config_only: restoreOpts.config_only || false,
        skip_db: restoreOpts.skip_db || false,
        skip_redis: restoreOpts.skip_redis || false,
      })
      message.success(res.data.message || 'Restore completed')
      setRestoreFile(null)
      setRestoreOpts({})
      setActiveTab('list')
    } catch (err) {
      message.error(err.response?.data?.detail || 'Restore failed')
    } finally {
      setRestoring(false)
    }
  }

  const uploadRestore = async (info) => {
    if (info.file.status === 'done') {
      message.success(info.file.response?.message || 'Upload & restore completed')
      loadBackups()
    } else if (info.file.status === 'error') {
      message.error(info.file.response?.detail || 'Upload failed')
    }
  }

  const columns = [
    {
      title: 'Filename',
      dataIndex: 'filename',
      key: 'filename',
      render: (v) => <Text code copyable>{v}</Text>,
    },
    {
      title: 'Size',
      dataIndex: 'size_bytes',
      key: 'size_bytes',
      width: 100,
      render: (v) => formatBytes(v),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v) => new Date(v).toLocaleString(),
    },
    {
      title: 'Actions',
      key: 'actions',
      width: 200,
      render: (_, record) => (
        <Space size="small">
          <Button size="small" icon={<DownloadOutlined />} onClick={() => downloadBackup(record.filename)}>Download</Button>
          <Button size="small" type="primary" onClick={() => { setRestoreFile(record.filename); setActiveTab('restore') }}>Restore</Button>
          <Popconfirm title="Delete this backup?" onConfirm={() => deleteBackup(record.filename)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const tabItems = [
    {
      key: 'list',
      label: 'Backups',
      children: (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
            <Title level={5} style={{ margin: 0 }}>Backup History</Title>
            <Button type="primary" icon={<SafetyCertificateOutlined />} onClick={createBackup} loading={creating}>
              Create Backup
            </Button>
          </div>
          <Table
            dataSource={backups}
            columns={columns}
            rowKey="filename"
            loading={loading}
            pagination={{ pageSize: 10 }}
            locale={{ emptyText: 'No backups yet. Click "Create Backup" to start.' }}
          />
        </>
      ),
    },
    {
      key: 'restore',
      label: 'Restore',
      children: (
        <div style={{ maxWidth: 600 }}>
          <Title level={5}>Restore from Backup</Title>
          <Alert
            message="Warning"
            description="Restoring a backup will overwrite current data. A pre-restore backup is created automatically."
            type="warning"
            showIcon
            icon={<WarningOutlined />}
            style={{ marginBottom: 16 }}
          />

          {restoreFile && (
            <Alert
              message={`Selected: ${restoreFile}`}
              type="info"
              showIcon
              closable
              onClose={() => setRestoreFile(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form layout="vertical">
            <Form.Item label="Select Backup File">
              <Checkbox checked={restoreOpts.db_only} onChange={(e) => setRestoreOpts({ ...restoreOpts, db_only: e.target.checked })}>
                Database only
              </Checkbox>
              <Checkbox checked={restoreOpts.config_only} onChange={(e) => setRestoreOpts({ ...restoreOpts, config_only: e.target.checked })}>
                Config only
              </Checkbox>
              <Checkbox checked={restoreOpts.skip_db} onChange={(e) => setRestoreOpts({ ...restoreOpts, skip_db: e.target.checked })}>
                Skip database
              </Checkbox>
              <Checkbox checked={restoreOpts.skip_redis} onChange={(e) => setRestoreOpts({ ...restoreOpts, skip_redis: e.target.checked })}>
                Skip Redis
              </Checkbox>
            </Form.Item>

            <Form.Item>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={restoreBackup}
                loading={restoring}
                disabled={!restoreFile}
                danger
              >
                Restore Backup
              </Button>
            </Form.Item>
          </Form>
        </div>
      ),
    },
    {
      key: 'upload',
      label: 'Upload & Restore',
      children: (
        <div style={{ maxWidth: 500 }}>
          <Title level={5}>Upload Backup Archive</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            Upload a .tar.gz backup file created by the backup script or web interface.
          </Text>
          <Dragger
            name="file"
            accept=".tar.gz"
            maxCount={1}
            action="/api/backups/upload-restore"
            headers={{ Authorization: `Bearer ${localStorage.getItem('token')}` }}
            onChange={uploadRestore}
          >
            <p className="ant-upload-drag-icon"><UploadOutlined style={{ fontSize: 48, color: '#1677ff' }} /></p>
            <p className="ant-upload-text">Click or drag backup file here</p>
            <p className="ant-upload-hint">Supports .tar.gz files created by AYAL HPC backup</p>
          </Dragger>
        </div>
      ),
    },
  ]

  return (
    <Card style={{ minHeight: 'calc(100vh - 160px)' }}>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={tabItems} />
    </Card>
  )
}
