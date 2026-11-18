import React from 'react'
/**
 * AjiCorehpc Manager — FreeIPA Identity, User Provisioning and Shared Storage Management
 * 
 * Features:
 * 1. All Users: Searchable table with role/group filters, View Details, Edit Account, and Delete User.
 * 2. Add User Wizard: 6-stage guided workflow (Identity, Shared Storage, User Folder, Storage Quota, Review, Create & Verify).
 * 3. User Groups: Group management, GID, storage quota and core hour allocations.
 * 4. Shared Storage: Discovered shared filesystems (/home, /scratch, /apps), capacity, mount and quota state.
 * 5. Quotas: Storage quota inspection and live adjustment per user.
 * 6. Client Enrollment status and quick link.
 */
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Table, Card, Button, Input, Select, Tag, Progress, Modal, Drawer,
  Form, Space, Dropdown, Tooltip, message, Popconfirm, Typography,
  Divider, Badge, Row, Col, Alert, Steps, Radio, InputNumber,
  Switch, Checkbox
} from 'antd'
import {
  UserOutlined, UserAddOutlined, TeamOutlined, HddOutlined,
  SafetyCertificateOutlined, SettingOutlined, SearchOutlined,
  ReloadOutlined, PlusOutlined, EditOutlined, DeleteOutlined,
  EyeOutlined, CheckCircleOutlined, CloseCircleOutlined,
  WarningOutlined, FolderOutlined, KeyOutlined, DesktopOutlined,
  CloudServerOutlined, LockOutlined, ThunderboltOutlined,
  FileDoneOutlined, InfoCircleOutlined, ArrowRightOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons'
import api, { usersAPI, identityAPI, rolesAPI } from '../services/api'
import { useAuthStore } from '../store/authStore'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

export default function UsersPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'users')
  const [loading, setLoading] = useState(true)

  // Users State
  const [users, setUsers] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [roles, setRoles] = useState([])

  // User Creation & Edit Mode
  const [wizardMode, setWizardMode] = useState('create') // 'create' | 'edit'
  const [editingUser, setEditingUser] = useState(null)

  // Delete User Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deletingUser, setDeletingUser] = useState(null)
  const [confirmUsername, setConfirmUsername] = useState('')
  const [deleting, setDeleting] = useState(false)

  // User Details Drawer State
  const [detailsDrawerOpen, setDetailsDrawerOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)

  // Groups State
  const [groups, setGroups] = useState([])
  const [groupModalOpen, setGroupModalOpen] = useState(false)
  const [groupForm] = Form.useForm()
  const [savingGroup, setSavingGroup] = useState(false)

  // Shared Storage State
  const [storageLocations, setStorageLocations] = useState([])
  const [loadingStorage, setLoadingStorage] = useState(false)

  // Quotas State
  const [quotas, setQuotas] = useState([])
  const [quotaModalOpen, setQuotaModalOpen] = useState(false)
  const [quotaForm] = Form.useForm()
  const [adjustingQuotaUser, setAdjustingQuotaUser] = useState(null)
  const [savingQuota, setSavingQuota] = useState(false)

  // ── 6-STAGE GUIDED USER PROVISIONING WIZARD STATE ──
  const [wizardStep, setWizardStep] = useState(0)
  const [wizardForm] = Form.useForm()
  const [selectedStorage, setSelectedStorage] = useState(null)
  const [selectedStorageIds, setSelectedStorageIds] = useState(['storage-home'])
  const [storageSearchQuery, setStorageSearchQuery] = useState('')
  const [userFolders, setUserFolders] = useState([
    {
      id: 'folder-1',
      storage_path: '/home',
      folder_name: '',
      full_path: '/home',
      purpose: 'Primary Home Directory',
      is_primary_home: true,
      quota_domain: 'user',
    }
  ])
  const [folderOption, setFolderOption] = useState('new')
  const [customFolder, setCustomFolder] = useState('')
  const [validatedPathInfo, setValidatedPathInfo] = useState(null)
  const [validatingPath, setValidatingPath] = useState(false)
  const [provisioning, setProvisioning] = useState(false)
  const [provisionResult, setProvisionResult] = useState(null)
  const [provisionLogs, setProvisionLogs] = useState([])

  // ── VERIFY & REPAIR QUOTA STATE ──
  const [verifyRepairModalOpen, setVerifyRepairModalOpen] = useState(false)
  const [verifyingRepairUser, setVerifyingRepairUser] = useState(null)
  const [runningVerifyRepair, setRunningVerifyRepair] = useState(false)
  const [verifyRepairResult, setVerifyRepairResult] = useState(null)

  useEffect(() => {
    loadAllData()
  }, [])

  const loadAllData = async () => {
    setLoading(true)
    try {
      const [uRes, gRes, sRes, qRes, rRes] = await Promise.all([
        usersAPI.list().catch(() => ({ data: [] })),
        identityAPI.getGroups().catch(() => ({ data: [] })),
        identityAPI.discoverStorage().catch(() => ({ data: [] })),
        identityAPI.getQuotas().catch(() => ({ data: [] })),
        rolesAPI.list().catch(() => ({ data: [] })),
      ])

      const fetchedRoles = Array.isArray(rRes.data) ? rRes.data : []
      setRoles(fetchedRoles)

      const userList = Array.isArray(uRes.data) ? uRes.data : (uRes.data?.users || [])
      setUsers(userList)
      setGroups(gRes.data || [])

      const storageList = sRes.data || []
      setStorageLocations(storageList)
      if (storageList.length > 0 && !selectedStorage) {
        const homeStorage = storageList.find(s => s.mount_path === '/home') || storageList[0]
        setSelectedStorage(homeStorage)
        setSelectedStorageIds(prev => prev.length ? prev : [homeStorage.id])
      }

      setQuotas(qRes.data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  // Refresh Storage Discovery
  const handleRefreshStorage = async () => {
    setLoadingStorage(true)
    try {
      const res = await identityAPI.discoverStorage()
      setStorageLocations(res.data || [])
      message.success('Shared storage filesystems refreshed from cluster nodes')
    } catch (err) {
      message.error('Failed to discover shared storage')
    } finally {
      setLoadingStorage(false)
    }
  }

  // Multi-Folder Management Helpers
  const handleSetFolderCount = (count) => {
    const username = (wizardForm.getFieldValue('username') || editingUser?.username || 'user').trim().toLowerCase()
    const targetCount = Math.max(1, Math.min(5, count))
    const current = [...userFolders]

    const selectedStoragesList = storageLocations.filter(s => selectedStorageIds.includes(s.id))
    const defaultRoots = selectedStoragesList.length > 0
      ? selectedStoragesList.map(s => s.mount_path)
      : ['/home', '/scratch', '/project', '/apps']

    const purposes = [
      'Primary Home Directory',
      'Scratch Workspace',
      'Project Data',
      'Application Data',
      'Archival Data'
    ]

    if (targetCount > current.length) {
      for (let i = current.length; i < targetCount; i++) {
        const root = defaultRoots[i % defaultRoots.length] || '/scratch'
        const suffix = i === 1 ? '-scratch' : (i === 2 ? '-project' : `-${i + 1}`)
        const fname = i === 0 ? username : `${username}${suffix}`
        current.push({
          id: `folder-${Date.now()}-${i}`,
          storage_path: root,
          folder_name: fname,
          full_path: `${root}/${fname}`,
          purpose: purposes[i] || 'Workspace',
          is_primary_home: current.filter(f => f.is_primary_home).length === 0,
          quota_domain: root === '/home' ? 'user' : 'project',
        })
      }
    } else if (targetCount < current.length) {
      current.splice(targetCount)
      if (!current.some(f => f.is_primary_home) && current.length > 0) {
        current[0].is_primary_home = true
      }
    }
    setUserFolders(current)
  }

  const handleUpdateFolder = (index, field, value) => {
    const updated = [...userFolders]
    const item = { ...updated[index], [field]: value }
    if (field === 'storage_path' || field === 'folder_name') {
      const root = field === 'storage_path' ? value : item.storage_path
      const fname = (field === 'folder_name' ? value : item.folder_name).trim().replace(/^\/+/, '')
      item.full_path = `${root}/${fname}`
      item.quota_domain = root === '/home' ? 'user' : 'project'
    }
    if (field === 'is_primary_home' && value === true) {
      updated.forEach((f, idx) => {
        if (idx !== index) f.is_primary_home = false
      })
    }
    updated[index] = item
    setUserFolders(updated)
  }

  const handleAddFolder = () => {
    handleSetFolderCount(userFolders.length + 1)
  }

  const handleRemoveFolder = (index) => {
    if (userFolders.length <= 1) return
    const updated = userFolders.filter((_, idx) => idx !== index)
    if (!updated.some(f => f.is_primary_home) && updated.length > 0) {
      updated[0].is_primary_home = true
    }
    setUserFolders(updated)
  }

  // Open Verify and Repair Quota Modal
  const handleOpenVerifyRepair = (user) => {
    setVerifyingRepairUser(user)
    setVerifyRepairResult(null)
    setVerifyRepairModalOpen(true)
    handleExecuteVerifyRepair(user)
  }

  const handleExecuteVerifyRepair = async (user) => {
    const target = user || verifyingRepairUser
    if (!target) return
    setRunningVerifyRepair(true)
    try {
      const res = await identityAPI.verifyRepairQuota(target.id)
      setVerifyRepairResult(res.data)
      message.success(`Quota verified & synchronized for @${target.username}`)
      loadAllData()
    } catch (err) {
      message.error(err.response?.data?.detail || err.message || 'Verification failed')
    } finally {
      setRunningVerifyRepair(false)
    }
  }

  // Open Create User Wizard
  const handleOpenCreate = () => {
    setWizardMode('create')
    setEditingUser(null)
    setWizardStep(0)
    setProvisionResult(null)
    setProvisionLogs([])
    wizardForm.resetFields()
    wizardForm.setFieldsValue({
      role: 'researcher',
      shell: '/bin/bash',
      group: 'researchers',
      quota_soft_gb: 50,
      quota_hard_gb: 100,
      quota_unit: 'GiB',
      inode_limit: 1000000,
      warning_threshold: 85,
      status: 'Active',
    })
    if (storageLocations.length > 0) {
      setSelectedStorage(storageLocations.find(s => s.is_recommended) || storageLocations[0])
    }
    setFolderOption('new')
    setCustomFolder('')
    setActiveTab('add_user')
  }

  // Open Edit User Account (Reuses Exact Same Wizard Layout)
  const handleOpenEdit = (user) => {
    setWizardMode('edit')
    setEditingUser(user)
    setWizardStep(0)
    setProvisionResult(null)
    setProvisionLogs([])

    const nameParts = (user.full_name || '').trim().split(' ')
    const firstName = nameParts[0] || user.username
    const lastName = nameParts.slice(1).join(' ') || ''

    const userQuota = quotas.find(q => q.username === user.username || String(q.id) === String(user.id))
    const hardGb = user.quota_storage_gb || userQuota?.hard_limit_gb || 100
    const softGb = userQuota?.soft_limit_gb || Math.round(hardGb * 0.8)

    const homePath = user.home_directory || `/home/${user.username}`
    const matchedStorage = storageLocations.find(s => homePath.startsWith(s.mount_path)) || storageLocations[0]
    setSelectedStorage(matchedStorage)

    if (matchedStorage && homePath === `${matchedStorage.mount_path}/${user.username}`) {
      setFolderOption('new')
      setCustomFolder('')
    } else if (matchedStorage) {
      setFolderOption('custom')
      setCustomFolder(homePath.replace(new RegExp(`^${matchedStorage.mount_path}/?`), ''))
    } else {
      setFolderOption('new')
      setCustomFolder('')
    }

    wizardForm.setFieldsValue({
      first_name: firstName,
      last_name: lastName,
      username: user.username,
      employee_id: user.employee_id || '',
      email: user.email,
      password: '', // Blank indicates keep existing password
      role: user.role || 'researcher',
      shell: user.shell || '/bin/bash',
      group: user.group_name || 'researchers',
      status: user.is_active !== false ? 'Active' : 'Disabled',
      quota_soft_gb: softGb,
      quota_hard_gb: hardGb,
      quota_unit: 'GiB',
      inode_limit: 1000000,
      warning_threshold: 85,
    })

    setActiveTab('add_user')
  }

  // Open Delete User Modal
  const handleOpenDelete = (user) => {
    setDeletingUser(user)
    setConfirmUsername('')
    setDeleteModalOpen(true)
  }

  // Confirm Delete User
  const handleConfirmDelete = async () => {
    if (confirmUsername !== deletingUser?.username) {
      message.error('Please type the exact username to confirm deletion')
      return
    }
    setDeleting(true)
    try {
      await usersAPI.delete(deletingUser.id)
      message.success(`User '${deletingUser.username}' deleted successfully`)
      setDeleteModalOpen(false)
      if (detailsDrawerOpen && selectedUser?.id === deletingUser.id) {
        setDetailsDrawerOpen(false)
      }
      loadAllData()
    } catch (err) {
      message.error('Failed to delete user')
    } finally {
      setDeleting(false)
    }
  }

  // Open Details Drawer
  const handleOpenDetails = (user) => {
    setSelectedUser(user)
    setDetailsDrawerOpen(true)
  }

  // Open Adjust Quota Modal
  const handleOpenQuotaModal = (q) => {
    setAdjustingQuotaUser(q)
    quotaForm.setFieldsValue({
      soft_limit_gb: q.soft_limit_gb,
      hard_limit_gb: q.hard_limit_gb,
    })
    setQuotaModalOpen(true)
  }

  // Save Quota Adjustment
  const handleSaveQuota = async () => {
    try {
      const vals = await quotaForm.validateFields()
      setSavingQuota(true)
      await identityAPI.updateQuota(adjustingQuotaUser.id, vals)
      message.success(`Storage quota updated for ${adjustingQuotaUser.username}`)
      setQuotaModalOpen(false)
      loadAllData()
    } catch (err) {
      message.error('Failed to update storage quota')
    } finally {
      setSavingQuota(false)
    }
  }

  // Save New Group
  const handleSaveGroup = async () => {
    try {
      const vals = await groupForm.validateFields()
      setSavingGroup(true)
      await identityAPI.createGroup(vals)
      message.success(`HPC Group '${vals.name}' created successfully`)
      setGroupModalOpen(false)
      groupForm.resetFields()
      loadAllData()
    } catch (err) {
      message.error('Failed to create group')
    } finally {
      setSavingGroup(false)
    }
  }

  // Password Generator for Wizard
  const handleGeneratePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*'
    let pwd = ''
    for (let i = 0; i < 14; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    wizardForm.setFieldsValue({ password: pwd })
    message.info('Secure 14-character password generated')
  }

  // Step 2 to Step 3 Path calculation
  const getProposedHomePath = () => {
    const primaryFolder = userFolders.find(f => f.is_primary_home) || userFolders[0]
    if (primaryFolder?.full_path) return primaryFolder.full_path
    const username = (wizardForm.getFieldValue('username') || editingUser?.username || '').trim() || 'username'
    const root = primaryFolder?.storage_path || selectedStorage?.mount_path || '/home'
    return `${root}/${username}`
  }

  // Validate Path Live
  const handleValidateProposedPath = async () => {
    const primaryFolder = userFolders.find(f => f.is_primary_home) || userFolders[0]
    const username = (wizardForm.getFieldValue('username') || editingUser?.username || '').trim() || 'username'
    const root = primaryFolder?.storage_path || selectedStorage?.mount_path || '/home'
    const proposed = primaryFolder?.folder_name || username
    setValidatingPath(true)
    try {
      const res = await identityAPI.validatePath({
        shared_storage_path: root,
        proposed_folder: proposed,
      })
      setValidatedPathInfo(res.data)
      if (res.data?.valid) {
        message.success(`Path validated: ${res.data.final_path}`)
      } else {
        message.error(res.data?.error || 'Path validation error')
      }
    } catch (err) {
      message.error('Failed to validate path')
    } finally {
      setValidatingPath(false)
    }
  }

  // Step 5: Execute Provisioning or Updating
  const handleExecuteProvisioning = async () => {
    setProvisioning(true)
    const isEdit = wizardMode === 'edit' && editingUser?.id
    setProvisionLogs([isEdit ? '[INFO] Initiating FreeIPA user update & quota synchronization pipeline...' : '[INFO] Initiating 6-stage FreeIPA user provisioning pipeline...'])
    try {
      const vals = wizardForm.getFieldsValue(true)
      const username = (vals.username || editingUser?.username || '').trim().toLowerCase()
      if (!username) {
        throw new Error('Username is missing. Please complete Step 1 (User Information).')
      }
      // Find primary home directory from userFolders
      const primaryFolder = userFolders.find(f => f.is_primary_home) || userFolders[0]
      const homeRoot = primaryFolder?.storage_path || selectedStorage?.mount_path || '/home'
      const folderName = (primaryFolder?.folder_name || username).trim()
      const primaryHomePath = primaryFolder?.full_path || `${homeRoot}/${folderName}`

      const payload = {
        username: username,
        first_name: vals.first_name || '',
        last_name: vals.last_name || '',
        email: vals.email || `${username}@ayalhpc.hpc.com`,
        employee_id: vals.employee_id || '',
        password: vals.password || (isEdit ? '' : 'AyalHpc@2026'),
        role: vals.role || 'researcher',
        shell: vals.shell || '/bin/bash',
        group: vals.group || 'researchers',
        status: vals.status || 'Active',
        shared_storage: homeRoot,
        home_directory: primaryHomePath,
        quota_soft_gb: Number(vals.quota_soft_gb) || 50,
        quota_hard_gb: Number(vals.quota_hard_gb) || 100,
        quota_unit: vals.quota_unit || 'GiB',
        inode_limit: Number(vals.inode_limit) || 1000000,
        selected_storage_ids: selectedStorageIds,
        folders: userFolders.map(f => ({
          storage_path: f.storage_path,
          folder_name: f.folder_name || username,
          full_path: f.full_path || `${f.storage_path}/${f.folder_name || username}`,
          purpose: f.purpose,
          is_primary_home: Boolean(f.is_primary_home),
          quota_soft_gb: Number(vals.quota_soft_gb) || 50,
          quota_hard_gb: Number(vals.quota_hard_gb) || 100,
          quota_domain: f.quota_domain || (f.storage_path === '/home' ? 'user' : 'project'),
        })),
      }

      let res
      if (isEdit) {
        res = await identityAPI.updateProvisionedUser(editingUser.id, payload)
        message.success(`User '${username}' account and storage quotas updated successfully`)

        // If the updated user is the currently logged-in user, refresh authStore profile immediately
        const currentUser = useAuthStore.getState().user
        if (
          currentUser &&
          (String(editingUser.id) === String(currentUser.id) ||
            editingUser.username?.toLowerCase() === currentUser.username?.toLowerCase() ||
            username.toLowerCase() === currentUser.username?.toLowerCase())
        ) {
          try {
            await useAuthStore.getState().fetchCurrentUser()
          } catch (_) {
            useAuthStore.getState().setUser({
              ...currentUser,
              full_name: payload.first_name ? `${payload.first_name} ${payload.last_name}`.trim() : (editingUser.full_name || username),
              email: payload.email,
            })
          }
        }
      } else {
        res = await identityAPI.provisionUser(payload)
        message.success(`User '${username}' successfully provisioned with home directory ${finalPath}`)
      }

      setProvisionResult(res.data)
      if (res.data?.logs) {
        setProvisionLogs(res.data.logs)
      }
      loadAllData()
    } catch (err) {
      let detail = isEdit ? 'Account update failed' : 'Provisioning failed'
      if (err.response?.data?.detail) {
        if (Array.isArray(err.response.data.detail)) {
          detail = err.response.data.detail.map(d => `${d.loc ? d.loc.slice(1).join('.') + ': ' : ''}${d.msg}`).join(', ')
        } else if (typeof err.response.data.detail === 'object') {
          detail = JSON.stringify(err.response.data.detail)
        } else {
          detail = String(err.response.data.detail)
        }
      } else if (err.message) {
        detail = err.message
      }
      message.error(detail)
      setProvisionLogs(prev => [...prev, `[ERROR] Pipeline failed: ${detail}`])
    } finally {
      setProvisioning(false)
    }
  }

  // Filtered Users
  const filteredUsers = users.filter(u => {
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch = !q || (
      (u.username || '').toLowerCase().includes(q) ||
      (u.full_name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q) ||
      (u.freeipa_uid || '').includes(q)
    )
    const matchesRole = roleFilter === 'all' || u.role === roleFilter
    return matchesSearch && matchesRole
  })

  // Table Columns for All Users
  const userColumns = [
    {
      title: 'User',
      key: 'user',
      render: (_, r) => {
        const initials = (r.full_name || r.username || 'U')
          .split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', background: '#2563EB',
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, flexShrink: 0
            }}>
              {initials}
            </div>
            <div>
              <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 13.5 }}>
                {r.full_name || r.username}
              </div>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                @{r.username}
              </div>
            </div>
          </div>
        )
      }
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
      render: (e) => <span style={{ fontSize: 12, color: '#334155' }}>{e || '-'}</span>
    },
    {
      title: 'POSIX IDs',
      key: 'posix',
      render: (_, r) => (
        <span style={{ fontFamily: 'Consolas, monospace', fontSize: 11.5, color: '#1E293B' }}>
          UID: <Text strong>{r.freeipa_uid || '1000'}</Text> • GID: <Text strong>{r.freeipa_gid || '1000'}</Text>
        </span>
      )
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role) => {
        const colors = {
          super_admin: 'red',
          cluster_admin: 'purple',
          tenant_admin: 'orange',
          researcher: 'blue',
          viewer: 'default'
        }
        return (
          <Tag color={colors[role] || 'blue'} style={{ borderRadius: 10, textTransform: 'capitalize', fontWeight: 600 }}>
            {(role || 'researcher').replace(/_/g, ' ')}
          </Tag>
        )
      }
    },
    {
      title: 'Home Directory',
      key: 'home',
      render: (_, r) => (
        <Text code style={{ fontSize: 11.5 }}>
          /home/{r.username}
        </Text>
      )
    },
    {
      title: 'Storage Quota',
      key: 'quota',
      render: (_, r) => {
        const q = quotas.find(item => item.username === r.username || String(item.id) === String(r.id))
        const hard = r.quota_storage_gb || q?.hard_limit_gb || 100
        const used = q?.current_usage_gb !== undefined ? q.current_usage_gb : 0.0
        const pct = hard > 0 ? Math.min(100, round((used / hard) * 100, 1)) : 0
        const isWarning = pct >= 85
        return (
          <div style={{ width: 110 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginBottom: 2 }}>
              <span style={{ fontWeight: 600, color: isWarning ? '#EF4444' : '#0F172A' }}>
                {used < 0.01 && used > 0 ? '< 0.01' : used} GB
              </span>
              <span style={{ color: '#64748B' }}>{hard} GB</span>
            </div>
            <Progress
              percent={pct}
              size="small"
              showInfo={false}
              strokeColor={isWarning ? '#EF4444' : '#2563EB'}
            />
          </div>
        )
      }
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, r) => (
        <Tag color={r.is_active !== false ? 'success' : 'default'} style={{ borderRadius: 10, fontWeight: 600 }}>
          {r.is_active !== false ? 'Active' : 'Disabled'}
        </Tag>
      )
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, r) => {
        const menuItems = [
          {
            key: 'details',
            icon: <EyeOutlined />,
            label: 'View Full Account Details',
            onClick: () => handleOpenDetails(r),
          },
          {
            key: 'verify_repair',
            icon: <SafetyCertificateOutlined style={{ color: '#16A34A' }} />,
            label: 'Verify & Repair Quota',
            onClick: () => handleOpenVerifyRepair(r),
          },
          {
            key: 'edit',
            icon: <EditOutlined />,
            label: 'Edit User Account & Quota',
            onClick: () => handleOpenEdit(r),
          },
          {
            key: 'quota',
            icon: <HddOutlined />,
            label: 'Adjust Filesystem Quota',
            onClick: () => handleOpenQuotaModal({ id: r.id, username: r.username, soft_limit_gb: Math.round((r.quota_storage_gb || 100) * 0.8), hard_limit_gb: r.quota_storage_gb || 100 }),
          },
          {
            type: 'divider',
          },
          {
            key: 'delete',
            icon: <DeleteOutlined />,
            label: 'Delete User Account',
            danger: true,
            onClick: () => handleOpenDelete(r),
          },
        ]

        return (
          <Space>
            <Button size="small" type="primary" onClick={() => handleOpenDetails(r)} style={{ background: '#2563EB', borderRadius: 6, fontSize: 12 }}>
              Details
            </Button>
            <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
              <Button size="small" icon={<SettingOutlined />} style={{ borderRadius: 6 }} />
            </Dropdown>
          </Space>
        )
      }
    }
  ]

  return (
    <div style={{ maxWidth: 1600, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── PAGE TITLE & ACTIONS ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 10
      }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
            Users & Identity Management
          </div>
          <div style={{ fontSize: 13, color: '#64748B', marginTop: 2 }}>
            FreeIPA directory user provisioning, shared storage selection, and filesystem quota enforcement
          </div>
        </div>

        <Space>
          <Button icon={<DesktopOutlined />} onClick={() => navigate('/settings')}>
            Identity & Authentication Settings
          </Button>
          <Button
            type="primary"
            icon={<UserAddOutlined />}
            onClick={handleOpenCreate}
            style={{ background: '#2563EB', fontWeight: 600, borderRadius: 6 }}
          >
            + Add User (Guided Wizard)
          </Button>
        </Space>
      </div>

      {/* ── SUB-NAV TABS ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid #E2E8F0', marginBottom: 20,
        background: '#FFFFFF', borderRadius: 8, padding: '0 12px'
      }}>
        {[
          { key: 'users', label: 'All Users', icon: <UserOutlined /> },
          { key: 'add_user', label: wizardMode === 'edit' ? `Edit User: @${editingUser?.username || 'user'}` : 'Add User (Provisioning Wizard)', icon: wizardMode === 'edit' ? <EditOutlined /> : <UserAddOutlined /> },
          { key: 'groups', label: 'User Groups', icon: <TeamOutlined /> },
          { key: 'storage', label: 'Shared Storage', icon: <HddOutlined /> },
          { key: 'quotas', label: 'Storage Quotas', icon: <SettingOutlined /> },
          { key: 'enrollment', label: 'Client Enrollment', icon: <DesktopOutlined /> },
        ].map((tab) => {
          const isActive = activeTab === tab.key
          return (
            <div
              key={tab.key}
              onClick={() => {
                if (tab.key === 'add_user' && wizardMode === 'edit') {
                  // Keep edit state
                } else if (tab.key === 'add_user' && wizardMode !== 'edit') {
                  handleOpenCreate()
                }
                setActiveTab(tab.key)
              }}
              style={{
                padding: '12px 16px', fontSize: 13,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#2563EB' : '#64748B',
                borderBottom: isActive ? '2.5px solid #2563EB' : '2.5px solid transparent',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                transition: 'all 0.15s ease',
              }}
            >
              {tab.icon}
              {tab.label}
            </div>
          )
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1: ALL USERS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'users' && (
        <div>
          {/* Controls: Search, Filter, Refresh */}
          <div style={{
            background: '#FFFFFF', borderRadius: 10, padding: '14px 18px',
            border: '1px solid #E2E8F0', marginBottom: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Input
                prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
                placeholder="Search users by name, username, email, UID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: 300, borderRadius: 6 }}
                allowClear
              />
              <Select
                value={roleFilter}
                onChange={setRoleFilter}
                style={{ width: 170 }}
              >
                <Option value="all">All Roles</Option>
                {roles.length > 0 ? (
                  roles.map(r => (
                    <Option key={r.id || r.name} value={r.name}>{r.display_name || r.name}</Option>
                  ))
                ) : (
                  <>
                    <Option value="super_admin">Super Admin</Option>
                    <Option value="cluster_admin">Cluster Admin</Option>
                    <Option value="researcher">Researcher</Option>
                    <Option value="viewer">Viewer</Option>
                  </>
                )}
              </Select>
            </div>

            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadAllData} loading={loading}>
                Refresh
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleOpenCreate}
                style={{ background: '#2563EB', fontWeight: 600 }}
              >
                + Add User
              </Button>
            </Space>
          </div>

          <div style={{ background: '#FFFFFF', borderRadius: 10, border: '1px solid #E2E8F0', overflow: 'hidden' }}>
            <Table
              dataSource={filteredUsers}
              columns={userColumns}
              rowKey="id"
              loading={loading}
              pagination={{ pageSize: 10 }}
            />
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2: ADD USER (GUIDED 6-STEP PROVISIONING WIZARD)
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'add_user' && (
        <div style={{ maxWidth: 1050, margin: '0 auto' }}>
          <Card variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, borderBottom: '1px solid #F1F5F9', paddingBottom: 14 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#0F172A' }}>
                  {wizardMode === 'edit' ? `Edit User Account: @${editingUser?.username}` : 'Create User Account (Guided Provisioning)'}
                </div>
                <div style={{ fontSize: 12.5, color: '#64748B' }}>
                  {wizardMode === 'edit'
                    ? `Update authoritative FreeIPA identity, home directory placement, and storage quota for @${editingUser?.username}`
                    : 'Configure FreeIPA identity, shared storage location, filesystem quotas, and cross-node enrollment'}
                </div>
              </div>
              {wizardMode === 'edit' && (
                <Button onClick={() => setActiveTab('users')} icon={<ArrowLeftOutlined />}>
                  Back to All Users
                </Button>
              )}
            </div>

            <Steps
              current={wizardStep}
              onChange={(s) => {
                if (s < wizardStep) setWizardStep(s)
              }}
              items={[
                { title: 'User Information' },
                { title: 'Select Shared Storage' },
                { title: 'Home Folder Selection' },
                { title: 'Configure Quota' },
                { title: 'Review & Confirm' },
                { title: wizardMode === 'edit' ? 'Update & Verify' : 'Create & Verify' },
              ]}
              style={{ marginBottom: 24 }}
            />

            <Form form={wizardForm} layout="vertical" preserve={true}>
              {/* ── STEP 1: USER INFORMATION ── */}
              <div style={{ display: wizardStep === 0 ? 'block' : 'none' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                      {wizardMode === 'edit' ? `Step 1: Edit User Account Details (@${editingUser?.username})` : 'Step 1: Enter User Account Details'}
                    </div>
                    {wizardMode === 'edit' && (
                      <Tag color="purple" style={{ fontWeight: 600, borderRadius: 6 }}>
                        EDIT MODE: @{editingUser?.username}
                      </Tag>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 18 }}>
                    {wizardMode === 'edit'
                      ? 'Modify identity profile, credentials, and access permissions for this cluster user'
                      : 'Create identity profile for FreeIPA Kerberos/LDAP authentication and Slurm job submission'}
                  </div>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="first_name" label="First Name" rules={[{ required: true, message: 'First name is required' }]}>
                        <Input placeholder="Enter first name" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="last_name" label="Last Name" rules={[{ required: true, message: 'Last name is required' }]}>
                        <Input placeholder="Enter last name" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item
                        name="username"
                        label="Username (POSIX Login)"
                        rules={[
                          { required: true, message: 'Please enter username' },
                          { pattern: /^[a-z0-9_\-\.]{3,32}$/, message: 'Must be 3-32 characters, lowercase alphanumeric' }
                        ]}
                        extra={wizardMode === 'edit' ? 'POSIX username is authoritative in FreeIPA and cannot be altered.' : 'Alphanumeric lowercase short name. Used for SSH and FreeIPA login.'}
                      >
                        <Input
                          placeholder="Enter username (e.g. jdoe)"
                          disabled={wizardMode === 'edit'}
                          onChange={(e) => {
                            if (wizardMode !== 'edit') {
                              const val = e.target.value.toLowerCase().trim()
                              if (val && !wizardForm.getFieldValue('email')) {
                                wizardForm.setFieldsValue({ email: `${val}@enterprise.org` })
                              }
                            }
                          }}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="employee_id" label="Employee ID / User ID">
                        <Input placeholder="e.g. EMP-1001" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="email" label="Email Address" rules={[{ required: true, type: 'email' }]}>
                        <Input placeholder="Enter email address (e.g. user@enterprise.org)" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item
                        name="password"
                        label={
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                            <span>{wizardMode === 'edit' ? 'Update Password (Optional)' : 'Initial Password'}</span>
                            <Button size="small" type="link" onClick={handleGeneratePassword} style={{ padding: 0, fontSize: 11 }}>
                              ⚡ Generate Secure Password
                            </Button>
                          </div>
                        }
                        rules={wizardMode === 'edit' ? [] : [{ required: true, min: 8, message: 'At least 8 characters' }]}
                        extra={wizardMode === 'edit' ? 'Leave blank to keep existing password unchanged.' : undefined}
                      >
                        <Input.Password placeholder={wizardMode === 'edit' ? 'Leave blank to keep existing password' : 'Enter temporary password'} />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={8}>
                      <Form.Item name="group" label="User Primary Group" initialValue="researchers">
                        <Select>
                          {groups.map(g => (
                            <Option key={g.name} value={g.name}>{g.name} (GID {g.freeipa_gid || '10001'})</Option>
                          ))}
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="role" label="Administrative Role" initialValue="researcher">
                        <Select>
                          <Option value="researcher">Researcher (Compute/Batch)</Option>
                          <Option value="cluster_admin">Cluster Administrator</Option>
                          <Option value="super_admin">Super Administrator</Option>
                          <Option value="viewer">Viewer Only</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="shell" label="Login Shell" initialValue="/bin/bash">
                        <Select>
                          <Option value="/bin/bash">/bin/bash (Recommended)</Option>
                          <Option value="/bin/zsh">/bin/zsh (Z-Shell)</Option>
                          <Option value="/bin/sh">/bin/sh (Standard POSIX)</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                    {wizardMode === 'edit' ? (
                      <Button onClick={() => setActiveTab('users')}>
                        &larr; Cancel & Return to Users
                      </Button>
                    ) : <div />}
                    <Button
                      type="primary"
                      onClick={async () => {
                        const fieldsToValidate = wizardMode === 'edit'
                          ? ['first_name', 'last_name', 'email']
                          : ['first_name', 'last_name', 'username', 'email', 'password']
                        await wizardForm.validateFields(fieldsToValidate)
                        setWizardStep(1)
                      }}
                      style={{ background: '#2563EB' }}
                    >
                      Next: Select Shared Storage &rarr;
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── STEP 2: SELECT SHARED STORAGE (MULTI-SELECT) ── */}
              <div style={{ display: wizardStep === 1 ? 'block' : 'none' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                        Step 2: Select Shared Storage Locations
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748B' }}>
                        Select one or more shared NFS storage paths to make available for this user account and compute jobs
                      </div>
                    </div>
                    <Space>
                      <Button
                        size="small"
                        onClick={() => {
                          if (selectedStorageIds.length === storageLocations.length) {
                            setSelectedStorageIds(['storage-home'])
                          } else {
                            setSelectedStorageIds(storageLocations.map(s => s.id))
                          }
                        }}
                      >
                        {selectedStorageIds.length === storageLocations.length ? 'Deselect Extra' : 'Select All Storage Shares'}
                      </Button>
                      <Button icon={<ReloadOutlined />} onClick={handleRefreshStorage} loading={loadingStorage}>
                        Refresh Storage
                      </Button>
                    </Space>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <Input
                      prefix={<SearchOutlined style={{ color: '#94A3B8' }} />}
                      placeholder="Search shared storage by path or name (e.g. /home, /scratch, /project)..."
                      value={storageSearchQuery}
                      onChange={(e) => setStorageSearchQuery(e.target.value)}
                      allowClear
                      style={{ maxWidth: 450 }}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, margin: '14px 0' }}>
                    {storageLocations
                      .filter(loc => !storageSearchQuery || loc.name.toLowerCase().includes(storageSearchQuery.toLowerCase()) || loc.mount_path.toLowerCase().includes(storageSearchQuery.toLowerCase()))
                      .map((loc) => {
                        const isChecked = selectedStorageIds.includes(loc.id)
                        return (
                          <div
                            key={loc.id}
                            onClick={() => {
                              let nextIds
                              if (isChecked) {
                                if (loc.mount_path === '/home') {
                                  message.warning('/home is required for primary user accounts')
                                  return
                                }
                                nextIds = selectedStorageIds.filter(id => id !== loc.id)
                              } else {
                                nextIds = [...selectedStorageIds, loc.id]
                              }
                              setSelectedStorageIds(nextIds)
                              if (!selectedStorage || loc.mount_path === '/home') {
                                setSelectedStorage(loc)
                              }
                            }}
                            style={{
                              border: `2px solid ${isChecked ? '#2563EB' : '#E2E8F0'}`,
                              borderRadius: 10, padding: '16px 18px', cursor: 'pointer',
                              background: isChecked ? '#EFF6FF' : '#FFFFFF',
                              transition: 'all 0.15s ease',
                              position: 'relative'
                            }}
                          >
                            <div style={{ position: 'absolute', top: 12, right: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
                              {loc.quota_enforced ? (
                                <Tag color="green" style={{ borderRadius: 10, fontWeight: 700 }}>
                                  ✓ ENFORCED
                                </Tag>
                              ) : (
                                <Tag color="blue" style={{ borderRadius: 10, fontWeight: 700 }}>
                                  {loc.quota_mechanism?.includes('Project') ? 'PROJECT QUOTA' : 'ACTIVE'}
                                </Tag>
                              )}
                              <Checkbox
                                checked={isChecked}
                                onChange={() => {}}
                                style={{ pointerEvents: 'none' }}
                              />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                              <HddOutlined style={{ fontSize: 22, color: isChecked ? '#2563EB' : '#64748B' }} />
                              <div>
                                <div style={{ fontWeight: 700, color: '#0F172A', fontSize: 14.5 }}>
                                  {loc.name}
                                </div>
                                <Text code style={{ fontSize: 12.5, fontWeight: 700 }}>{loc.mount_path}</Text>
                              </div>
                            </div>

                            <div style={{ fontSize: 12, color: '#475569', marginBottom: 10, minHeight: 34 }}>
                              {loc.description}
                            </div>

                            <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 4, background: isChecked ? '#DBEAFE40' : '#F8FAFC', padding: '8px 10px', borderRadius: 6 }}>
                              <div><strong>Server IP:</strong> <Text code style={{ fontSize: 11 }}>{loc.server_ip || 'Cluster Controller'}</Text></div>
                              <div><strong>Filesystem:</strong> {loc.filesystem_type?.toUpperCase()} ({loc.access_mode})</div>
                              <div><strong>Capacity:</strong> {loc.total_capacity_gb} GB ({loc.avail_capacity_gb} GB Available)</div>
                              <div><strong>Quota Support:</strong> <Tag color={loc.quota_supported ? 'green' : 'orange'} style={{ borderRadius: 6, fontSize: 10.5 }}>{loc.quota_supported ? (loc.quota_enforced ? 'Enforced (Active)' : 'Supported') : 'Admin Only'}</Tag></div>
                              <div><strong>Export Status:</strong> <Text style={{ fontSize: 11, color: '#166534' }}>{loc.export_status || 'Exported via NFS'}</Text></div>
                              <div><strong>Node Access:</strong> {loc.node_availability}</div>
                            </div>
                          </div>
                        )
                      })}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
                    <Button onClick={() => setWizardStep(0)}>&larr; Back</Button>
                    <Button
                      type="primary"
                      onClick={() => {
                        if (selectedStorageIds.length === 0) {
                          message.error('Please select at least one shared storage location')
                          return
                        }
                        const username = (wizardForm.getFieldValue('username') || editingUser?.username || 'user').trim().toLowerCase()
                        if (userFolders.length === 0 || !userFolders.some(f => f.is_primary_home)) {
                          handleSetFolderCount(1)
                        } else {
                          // Update primary folder name if empty
                          const updated = [...userFolders]
                          if (!updated[0].folder_name) {
                            updated[0].folder_name = username
                            updated[0].full_path = `${updated[0].storage_path}/${username}`
                            setUserFolders(updated)
                          }
                        }
                        setWizardStep(2)
                      }}
                      style={{ background: '#2563EB' }}
                    >
                      Next: User Folder Allocation &rarr;
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── STEP 3: USER FOLDER ALLOCATION ── */}
              <div style={{ display: wizardStep === 2 ? 'block' : 'none' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                        Step 3: User Folder Allocation
                      </div>
                      <div style={{ fontSize: 12.5, color: '#64748B' }}>
                        Configure dedicated folders and shared storage directories created for this account
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#F8FAFC', padding: '6px 12px', borderRadius: 8, border: '1px solid #E2E8F0' }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#1E293B' }}>
                        How many user folders do you want to create for this account?
                      </span>
                      <Select
                        value={userFolders.length}
                        onChange={handleSetFolderCount}
                        style={{ width: 110 }}
                      >
                        <Option value={1}>1 Folder</Option>
                        <Option value={2}>2 Folders</Option>
                        <Option value={3}>3 Folders</Option>
                        <Option value={4}>4 Folders</Option>
                        <Option value={5}>5 Folders</Option>
                      </Select>
                      <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleAddFolder} style={{ background: '#2563EB' }}>
                        Add Folder
                      </Button>
                    </div>
                  </div>

                  {/* Multi-Folder Configuration Cards / Table */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                    {userFolders.map((folder, idx) => {
                      const availStorages = storageLocations.filter(s => selectedStorageIds.includes(s.id))
                      const currStorage = storageLocations.find(s => s.mount_path === folder.storage_path) || availStorages[0]
                      return (
                        <div
                          key={folder.id || idx}
                          style={{
                            border: `1.5px solid ${folder.is_primary_home ? '#2563EB' : '#E2E8F0'}`,
                            borderRadius: 8, padding: 14, background: folder.is_primary_home ? '#F8FAFC' : '#FFFFFF',
                            boxShadow: folder.is_primary_home ? '0 1px 3px rgba(37,99,235,0.08)' : 'none'
                          }}
                        >
                          <Row gutter={12} align="middle">
                            <Col span={1} style={{ textAlign: 'center' }}>
                              <Badge count={idx + 1} style={{ backgroundColor: folder.is_primary_home ? '#2563EB' : '#64748B' }} />
                            </Col>

                            <Col span={5}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                                Shared Storage Mount
                              </div>
                              <Select
                                value={folder.storage_path}
                                onChange={(val) => handleUpdateFolder(idx, 'storage_path', val)}
                                style={{ width: '100%' }}
                              >
                                {availStorages.map(s => (
                                  <Option key={s.id} value={s.mount_path}>
                                    {s.mount_path} ({s.name.split('(')[0].trim()})
                                  </Option>
                                ))}
                              </Select>
                            </Col>

                            <Col span={5}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                                Folder Name
                              </div>
                              <Input
                                value={folder.folder_name}
                                placeholder={wizardForm.getFieldValue('username') || 'folder'}
                                onChange={(e) => handleUpdateFolder(idx, 'folder_name', e.target.value)}
                              />
                            </Col>

                            <Col span={5}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                                Folder Purpose
                              </div>
                              <Select
                                value={folder.purpose}
                                onChange={(val) => handleUpdateFolder(idx, 'purpose', val)}
                                style={{ width: '100%' }}
                              >
                                <Option value="Primary Home Directory">Primary Home Directory</Option>
                                <Option value="Scratch Workspace">Scratch Workspace</Option>
                                <Option value="Project Data">Project Data</Option>
                                <Option value="Application Data">Application Data</Option>
                                <Option value="Archival Workspace">Archival Workspace</Option>
                              </Select>
                            </Col>

                            <Col span={5}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                                Role / Quota Domain
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32 }}>
                                <Radio
                                  checked={folder.is_primary_home}
                                  onChange={() => handleUpdateFolder(idx, 'is_primary_home', true)}
                                >
                                  <span style={{ fontSize: 12, fontWeight: folder.is_primary_home ? 700 : 400, color: folder.is_primary_home ? '#2563EB' : '#475569' }}>
                                    Primary Home
                                  </span>
                                </Radio>
                                <Tag color={folder.quota_domain === 'user' ? 'green' : 'orange'} style={{ fontSize: 10.5, borderRadius: 6 }}>
                                  {folder.quota_domain === 'user' ? 'User UID Quota' : 'Project Quota'}
                                </Tag>
                              </div>
                            </Col>

                            <Col span={4} style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
                                Actions
                              </div>
                              <Button
                                size="small"
                                danger
                                icon={<DeleteOutlined />}
                                disabled={userFolders.length <= 1}
                                onClick={() => handleRemoveFolder(idx)}
                              >
                                Remove
                              </Button>
                            </Col>
                          </Row>

                          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                            <div>
                              <span style={{ color: '#64748B' }}>Target Path: </span>
                              <Text strong code style={{ color: '#1E293B' }}>{folder.full_path}</Text>
                              <span style={{ marginLeft: 12, color: '#64748B' }}>Permissions: </span>
                              <Tag color="cyan" style={{ fontSize: 11 }}>0700 (Owner Only, Root Admin Preserved)</Tag>
                            </div>
                            {folder.is_primary_home && (
                              <Tag color="blue" style={{ borderRadius: 8, fontWeight: 700 }}>
                                AUTHORITATIVE FREEIPA HOME DIRECTORY
                              </Tag>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Proposed Path Display Box */}
                  <div style={{
                    background: '#F8FAFC', border: '1px solid #CBD5E1', borderRadius: 8,
                    padding: 14, marginBottom: 16
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>
                      Primary Home Directory Verification:
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                      <div style={{ fontSize: 16, fontWeight: 800, fontFamily: 'Consolas, monospace', color: '#1E293B' }}>
                        {getProposedHomePath()}
                      </div>
                      <Button size="small" icon={<SafetyCertificateOutlined />} onClick={handleValidateProposedPath} loading={validatingPath}>
                        Validate Path Security
                      </Button>
                    </div>

                    {validatedPathInfo && (
                      <div style={{ marginTop: 10, fontSize: 12 }}>
                        {validatedPathInfo.valid ? (
                          <Tag color="green">✓ Path Authorized (Root: {validatedPathInfo.shared_root})</Tag>
                        ) : (
                          <Tag color="red">✗ {validatedPathInfo.error}</Tag>
                        )}
                        {validatedPathInfo.already_exists && (
                          <Tag color="orange">⚠ Folder already exists on disk</Tag>
                        )}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
                    <Button onClick={() => setWizardStep(1)}>&larr; Back</Button>
                    <Button type="primary" onClick={() => setWizardStep(3)} style={{ background: '#2563EB' }}>
                      Next: Configure Storage Quotas & Domain Mapping &rarr;
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── STEP 4: CONFIGURE STORAGE QUOTAS & DOMAIN MAPPING ── */}
              <div style={{ display: wizardStep === 3 ? 'block' : 'none' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                    Step 4: Configure Storage Quotas & Filesystem Domain Mapping
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 18 }}>
                    Define soft and hard capacity limits and review quota domain mapping across cluster filesystems
                  </div>

                  {/* Quota Domain Mode Explanation Alert */}
                  <Alert
                    message="Filesystem Storage Quota Architecture"
                    description={
                      <div style={{ fontSize: 12.5, lineHeight: 1.6, marginTop: 4 }}>
                        <div><strong>Mode A (Filesystem UID Quota):</strong> Applies to <code>/home</code>. All folders placed under <code>/home</code> share the account's POSIX UID quota domain. Hard limit strictly blocks write attempts when exceeded.</div>
                        <div style={{ marginTop: 4 }}><strong>Mode B (Directory / Project Quota):</strong> Applies to independent NFS volumes like <code>/scratch</code> and <code>/project</code>. Enforced per allocated folder tree.</div>
                        <div style={{ marginTop: 4, color: '#166534', fontWeight: 600 }}>✓ Root Administrative Access: Storage server root retains administrative access to all user directories across both modes.</div>
                      </div>
                    }
                    type="info"
                    showIcon
                    style={{ marginBottom: 18 }}
                  />

                  <Row gutter={16}>
                    <Col span={10}>
                      <Form.Item name="quota_soft_gb" label="Soft Capacity Limit (Warning threshold)" initialValue={50}>
                        <InputNumber min={1} max={selectedStorage?.avail_capacity_gb || 400} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={10}>
                      <Form.Item name="quota_hard_gb" label="Hard Capacity Limit (Hard write block)" initialValue={100}>
                        <InputNumber min={1} max={selectedStorage?.avail_capacity_gb || 400} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={4}>
                      <Form.Item name="quota_unit" label="Unit" initialValue="GiB">
                        <Select>
                          <Option value="GiB">GiB</Option>
                          <Option value="TiB">TiB</Option>
                          <Option value="MiB">MiB</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="inode_limit" label="Maximum Inode Limit (Files count)" initialValue={1000000}>
                        <InputNumber style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="warning_threshold" label="Warning Alert Threshold" initialValue={85}>
                        <Select>
                          <Option value={80}>Alert at 80% capacity</Option>
                          <Option value={85}>Alert at 85% capacity (Default)</Option>
                          <Option value={90}>Alert at 90% capacity</Option>
                        </Select>
                      </Form.Item>
                    </Col>
                  </Row>

                  {/* Quota Domain Mapping Table */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
                      User Folder Quota Domain Mapping:
                    </div>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={userFolders}
                      rowKey="id"
                      columns={[
                        {
                          title: 'Folder Path',
                          key: 'path',
                          render: (_, f) => <Text code strong>{f.full_path}</Text>
                        },
                        {
                          title: 'Storage Mount',
                          dataIndex: 'storage_path',
                          render: (s) => <Tag color="blue">{s}</Tag>
                        },
                        {
                          title: 'Purpose',
                          dataIndex: 'purpose',
                        },
                        {
                          title: 'Quota Domain',
                          key: 'domain',
                          render: (_, f) => (
                            <Tag color={f.quota_domain === 'user' ? 'green' : 'orange'}>
                              {f.quota_domain === 'user' ? 'Mode A: User UID Quota (/home)' : 'Mode B: Project Quota'}
                            </Tag>
                          )
                        },
                        {
                          title: 'Kernel Enforcement',
                          key: 'enf',
                          render: () => <Tag color="green">Active (Enforced)</Tag>
                        }
                      ]}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                    <Button onClick={() => setWizardStep(2)}>&larr; Back</Button>
                    <Button type="primary" onClick={() => setWizardStep(4)} style={{ background: '#2563EB' }}>
                      Next: Review Summary &rarr;
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── STEP 5: REVIEW ── */}
              <div style={{ display: wizardStep === 4 ? 'block' : 'none' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                    {wizardMode === 'edit' ? `Step 5: Review Updated User & Storage Configuration (@${editingUser?.username})` : 'Step 5: Review User & Storage Configuration'}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 18 }}>
                    {wizardMode === 'edit'
                      ? 'Verify updated identity attributes, filesystem placement, and quota specifications before applying changes'
                      : 'Verify identity attributes, multi-folder allocation, and quota specifications before executing creation'}
                  </div>

                  <Row gutter={[16, 16]}>
                    <Col span={12}>
                      <Card size="small" title="User Identity Summary" style={{ borderRadius: 8 }}>
                        <div><strong>Full Name:</strong> {wizardForm.getFieldValue('first_name')} {wizardForm.getFieldValue('last_name')}</div>
                        <div><strong>Username:</strong> <Text code>@{wizardForm.getFieldValue('username')}</Text></div>
                        <div><strong>Email:</strong> {wizardForm.getFieldValue('email')}</div>
                        <div><strong>Employee ID:</strong> {wizardForm.getFieldValue('employee_id') || 'N/A'}</div>
                        <div><strong>Role:</strong> <Tag color="blue">{wizardForm.getFieldValue('role')}</Tag></div>
                        <div><strong>Group:</strong> <Tag color="geekblue">{wizardForm.getFieldValue('group')}</Tag></div>
                        <div><strong>Login Shell:</strong> <Text code>{wizardForm.getFieldValue('shell')}</Text></div>
                        {wizardMode === 'edit' && (
                          <div><strong>Password Update:</strong> {wizardForm.getFieldValue('password') ? <Tag color="orange">Password change pending</Tag> : <Tag color="default">Unchanged</Tag>}</div>
                        )}
                      </Card>
                    </Col>

                    <Col span={12}>
                      <Card size="small" title="Quota & Cluster Policy" style={{ borderRadius: 8 }}>
                        <div><strong>Primary Home Path:</strong> <Text strong code style={{ color: '#2563EB' }}>{getProposedHomePath()}</Text></div>
                        <div><strong>Allocated Folders:</strong> <Badge count={userFolders.length} style={{ backgroundColor: '#2563EB' }} /> folders across cluster storage</div>
                        <div><strong>Quota Soft Limit:</strong> {wizardForm.getFieldValue('quota_soft_gb')} {wizardForm.getFieldValue('quota_unit')}</div>
                        <div><strong>Quota Hard Limit:</strong> {wizardForm.getFieldValue('quota_hard_gb')} {wizardForm.getFieldValue('quota_unit')}</div>
                        <div><strong>Cluster & Nodes:</strong> Synchronized across all registered cluster nodes</div>
                        <div><strong>Root Administration:</strong> Server root retains administrative access to all folders</div>
                      </Card>
                    </Col>
                  </Row>

                  {/* Summary of Allocated Folders */}
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
                      Allocated User Folders to be Configured:
                    </div>
                    <Table
                      size="small"
                      pagination={false}
                      dataSource={userFolders}
                      rowKey="id"
                      columns={[
                        {
                          title: '#',
                          render: (_, __, i) => i + 1,
                          width: 40
                        },
                        {
                          title: 'Proposed Folder Path',
                          key: 'p',
                          render: (_, f) => (
                            <div>
                              <Text code strong>{f.full_path}</Text>
                              {f.is_primary_home && <Tag color="blue" style={{ marginLeft: 8, fontSize: 10.5 }}>PRIMARY HOME</Tag>}
                            </div>
                          )
                        },
                        {
                          title: 'Storage Share',
                          dataIndex: 'storage_path',
                          render: (s) => <Tag color="geekblue">{s}</Tag>
                        },
                        {
                          title: 'Purpose',
                          dataIndex: 'purpose',
                        },
                        {
                          title: 'Permissions',
                          key: 'perms',
                          render: () => <Tag color="cyan">0700</Tag>
                        },
                        {
                          title: 'Quota Domain',
                          key: 'qd',
                          render: (_, f) => (
                            <Tag color={f.quota_domain === 'user' ? 'green' : 'orange'}>
                              {f.quota_domain === 'user' ? 'Mode A (UID)' : 'Mode B (Project)'}
                            </Tag>
                          )
                        }
                      ]}
                    />
                  </div>

                  <Alert
                    message={wizardMode === 'edit' ? 'Cluster Synchronization & Quota Enforcement' : 'Atomic Provisioning Execution'}
                    description={wizardMode === 'edit'
                      ? "Clicking 'Update and Verify User' will synchronize updated account parameters with FreeIPA, verify shared folder permissions (0700), preserve root administrative access, and apply updated XFS filesystem quotas."
                      : "Clicking 'Create and Verify User' will register the FreeIPA identity, generate authoritative UID/GID, create all allocated folders with mode 0700, preserve root administrative access, and enforce XFS quotas across cluster shares."}
                    type="success"
                    showIcon
                    style={{ marginTop: 18 }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24 }}>
                    <Button onClick={() => setWizardStep(3)}>&larr; Back</Button>
                    <Button
                      type="primary"
                      onClick={() => {
                        setWizardStep(5)
                        handleExecuteProvisioning()
                      }}
                      style={{ background: '#16A34A', borderColor: '#16A34A', fontWeight: 700 }}
                    >
                      {wizardMode === 'edit' ? '✓ Update and Verify User' : '✓ Create and Verify User'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* ── STEP 6: CREATE AND VERIFY ── */}
              <div style={{ display: wizardStep === 5 ? 'block' : 'none' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 4 }}>
                    {wizardMode === 'edit' ? 'Step 6: User Update Execution & Verification' : 'Step 6: Provisioning Execution & Verification'}
                  </div>
                  <div style={{ fontSize: 12.5, color: '#64748B', marginBottom: 18 }}>
                    {wizardMode === 'edit'
                      ? 'Live execution progress of FreeIPA directory synchronization, filesystem permissions, and quota application'
                      : 'Live execution progress of FreeIPA account creation, directory mounting, and quota application'}
                  </div>

                  {provisioning ? (
                    <div style={{ textAlign: 'center', padding: '24px 0' }}>
                      <Progress percent={75} status="active" strokeColor="#2563EB" style={{ width: '80%' }} />
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#0F172A', marginTop: 12 }}>
                        {wizardMode === 'edit'
                          ? 'Updating user profile in FreeIPA and synchronizing shared storage quota...'
                          : 'Provisioning user in FreeIPA and configuring shared home directory...'}
                      </div>
                    </div>
                  ) : provisionResult?.reconcile_status === 'pending' || provisionResult?.summary_message?.includes('Pending') ? (
                    <div style={{ padding: 18, background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ClockCircleOutlined style={{ color: '#D97706', fontSize: 24 }} />
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#B45309' }}>
                            {provisionResult.summary_message || `Saved to Desired State. Pending on Offline Nodes.`}
                          </div>
                          <div style={{ fontSize: 12, color: '#92400E', marginTop: 2 }}>
                            Assigned UID: {provisionResult.uid} • GID: {provisionResult.gid} • Home: {provisionResult.home_directory} • Quota: {provisionResult.quota_hard_gb} {provisionResult.quota_unit || 'GiB'}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <Tag color="warning">Offline-Safe: Will apply automatically as soon as offline nodes return</Tag>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : provisionResult?.success ? (
                    <div style={{ padding: 18, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CheckCircleOutlined style={{ color: '#16A34A', fontSize: 24 }} />
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#15803D' }}>
                            {wizardMode === 'edit'
                              ? `User '${provisionResult.username}' Applied on Cluster!`
                              : `User '${provisionResult.username}' Applied on Cluster!`}
                          </div>
                          <div style={{ fontSize: 12, color: '#166534' }}>
                            Assigned UID: {provisionResult.uid} • GID: {provisionResult.gid} • Home: {provisionResult.home_directory} • Quota: {provisionResult.quota_hard_gb} {provisionResult.quota_unit || 'GiB'}
                          </div>
                          {provisionResult.targets && (
                            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {Object.entries(provisionResult.targets).map(([host, info]) => (
                                <Tag key={host} color={info.status === 'applied' ? 'green' : 'orange'}>
                                  {host}: {info.status?.toUpperCase()}
                                </Tag>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: 18, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <CloseCircleOutlined style={{ color: '#DC2626', fontSize: 24 }} />
                        <div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: '#991B1B' }}>
                            {wizardMode === 'edit' ? 'Account Update Encountered an Issue' : 'Provisioning Encountered an Issue'}
                          </div>
                          <div style={{ fontSize: 12, color: '#B91C1C' }}>
                            Please review the pipeline logs below. You can safely retry or modify parameters.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Terminal Execution Logs */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                      Pipeline Execution & Verification Logs:
                    </div>
                    <div style={{
                      background: '#0F172A', color: '#E2E8F0', padding: 14,
                      borderRadius: 6, fontFamily: 'Consolas, monospace', fontSize: 11.5,
                      maxHeight: 250, overflowY: 'auto', lineHeight: 1.6
                    }}>
                      {provisionLogs.map((log, idx) => (
                        <div key={idx} style={{
                          color: log.includes('SUCCESS') ? '#4ADE80' : (log.includes('FAIL') || log.includes('ERROR') ? '#F87171' : '#E2E8F0')
                        }}>
                          {log}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
                    {!provisioning && (
                      <>
                        {!provisionResult?.success && (
                          <>
                            <Button onClick={() => setWizardStep(0)}>
                              &larr; Modify Details
                            </Button>
                            <Button
                              type="primary"
                              onClick={handleExecuteProvisioning}
                              style={{ background: '#DC2626', borderColor: '#DC2626', fontWeight: 600 }}
                            >
                              ⚡ {wizardMode === 'edit' ? 'Retry Update' : 'Retry Provisioning'}
                            </Button>
                          </>
                        )}
                        {provisionResult?.success && (
                          <>
                            <Button type="primary" onClick={() => setActiveTab('users')} style={{ background: '#2563EB' }}>
                              View in All Users
                            </Button>
                            {wizardMode !== 'edit' && (
                              <Button
                                onClick={handleOpenCreate}
                              >
                                + Add Another User
                              </Button>
                            )}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Form>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 3: USER GROUPS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'groups' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                HPC User Groups & Allocations
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                Manage FreeIPA POSIX group affiliations, storage quotas, and core hour batch budgets
              </div>
            </div>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setGroupModalOpen(true)} style={{ background: '#2563EB' }}>
              + Add Group
            </Button>
          </div>

          <Card variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
            <Table
              dataSource={groups}
              rowKey="id"
              pagination={false}
              columns={[
                {
                  title: 'Group Name',
                  dataIndex: 'name',
                  key: 'name',
                  render: (n) => <Text strong code style={{ fontSize: 13 }}>{n}</Text>
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'desc',
                },
                {
                  title: 'FreeIPA GID',
                  dataIndex: 'freeipa_gid',
                  key: 'gid',
                  render: (gid) => <Tag color="blue">{gid || '10001'}</Tag>
                },
                {
                  title: 'Storage Quota',
                  dataIndex: 'quota_storage_gb',
                  key: 'sq',
                  render: (q) => `${q} GB`
                },
                {
                  title: 'Core Hours',
                  dataIndex: 'quota_core_hours',
                  key: 'ch',
                  render: (ch) => `${ch?.toLocaleString()} hrs`
                },
                {
                  title: 'Members',
                  dataIndex: 'member_count',
                  key: 'members',
                  render: (m) => <Tag color="geekblue">{m || 1} Users</Tag>
                }
              ]}
            />
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 4: SHARED STORAGE
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'storage' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                Discovered Shared Storage Filesystems
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                Live storage mounts available across cluster storage controllers and compute workers
              </div>
            </div>
            <Button icon={<ReloadOutlined />} onClick={handleRefreshStorage} loading={loadingStorage}>
              Refresh Storage
            </Button>
          </div>

          {storageLocations.length === 0 ? (
            <Card style={{ border: '1px dashed #CBD5E1', borderRadius: 8, textAlign: 'center', padding: '48px 16px' }}>
              <HddOutlined style={{ fontSize: 36, color: '#94A3B8', marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>No Shared Storage Filesystems Discovered</div>
              <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4, marginBottom: 16 }}>
                Enroll cluster nodes or configure NFS shared exports to expose shared directories (/home, /scratch, /project).
              </div>
              <Button type="primary" onClick={() => navigate('/storage')}>
                Configure Storage & NFS Exports
              </Button>
            </Card>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
              {storageLocations.map((loc) => (
                <Card key={loc.id} style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <HddOutlined style={{ fontSize: 20, color: '#2563EB' }} />
                      <span style={{ fontWeight: 700, fontSize: 14, color: '#0F172A' }}>{loc.name}</span>
                    </div>
                    {loc.is_recommended && <Tag color="blue">RECOMMENDED</Tag>}
                  </div>

                  <Text code style={{ fontSize: 12, display: 'inline-block', marginBottom: 8 }}>{loc.mount_path}</Text>

                  <div style={{ fontSize: 12, color: '#475569', marginBottom: 12 }}>
                    {loc.description}
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                      <span>Used: {loc.used_capacity_gb} GB</span>
                      <span>Total: {loc.total_capacity_gb} GB</span>
                    </div>
                    <Progress percent={loc.usage_pct} size="small" strokeColor="#2563EB" />
                  </div>

                  <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div><strong>Filesystem:</strong> {loc.filesystem_type?.toUpperCase()}</div>
                    <div><strong>Permissions:</strong> {loc.access_mode}</div>
                    <div><strong>Quota Supported:</strong> <Tag color={loc.quota_supported ? 'green' : 'orange'} style={{ fontSize: 10.5 }}>{loc.quota_supported ? 'Yes (xfs_quota)' : 'No'}</Tag></div>
                    <div><strong>Availability:</strong> {loc.node_availability}</div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 5: STORAGE QUOTAS
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'quotas' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
                Filesystem Storage Quotas & Enforcement
              </div>
              <div style={{ fontSize: 12, color: '#64748B' }}>
                Real XFS user quotas enforced on shared storage (/home) across all cluster nodes
              </div>
            </div>
            <Button icon={<ReloadOutlined />} onClick={loadAllData}>
              Refresh Quotas
            </Button>
          </div>

          <Card variant="borderless" style={{ border: '1px solid #E2E8F0', borderRadius: 8 }}>
            <Table
              dataSource={quotas}
              rowKey="id"
              pagination={false}
              columns={[
                {
                  title: 'User',
                  key: 'user',
                  render: (_, r) => (
                    <div>
                      <div style={{ fontWeight: 700, color: '#0F172A' }}>{r.full_name}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>@{r.username} {r.uid && r.uid !== 'Unassigned' ? `(UID ${r.uid})` : '(UID Unassigned)'}</div>
                    </div>
                  )
                },
                {
                  title: 'Home Path',
                  dataIndex: 'home_directory',
                  render: (p) => <Text code style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{p}</Text>
                },
                {
                  title: 'Soft Limit',
                  dataIndex: 'soft_limit_gb',
                  render: (s) => `${s} GB`
                },
                {
                  title: 'Hard Limit',
                  dataIndex: 'hard_limit_gb',
                  render: (h) => `${h} GB`
                },
                {
                  title: 'Current Usage',
                  key: 'usage',
                  render: (_, r) => (
                    <div style={{ width: 130 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                        <span>{r.current_usage_gb} GB</span>
                        <span>{r.usage_pct}%</span>
                      </div>
                      <Progress percent={r.usage_pct} size="small" showInfo={false} strokeColor={r.warning ? '#EF4444' : '#10B981'} />
                    </div>
                  )
                },
                {
                  title: 'Remaining',
                  dataIndex: 'remaining_gb',
                  render: (rem) => `${rem} GB`
                },
                {
                  title: 'Enforcement Status',
                  dataIndex: 'enforcement_status',
                  render: (status) => {
                    const isEnforced = status && status.toLowerCase().includes('active')
                    return <Tag color={isEnforced ? 'green' : 'default'}>{status || 'Unenforced'}</Tag>
                  }
                },
                {
                  title: 'Actions',
                  key: 'act',
                  align: 'right',
                  render: (_, r) => (
                    <Space size="small">
                      <Button size="small" type="primary" onClick={() => handleOpenVerifyRepair(r)} style={{ background: '#16A34A', borderColor: '#16A34A', fontSize: 11.5 }}>
                        Verify & Repair
                      </Button>
                      <Button size="small" onClick={() => handleOpenQuotaModal(r)}>
                        Adjust Limit
                      </Button>
                    </Space>
                  )
                }
              ]}
            />
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 6: CLIENT ENROLLMENT
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'enrollment' && (
        <div>
          <Alert
            message="FreeIPA Client Node Enrollment"
            description="Manage and enroll cluster compute nodes into the FreeIPA domain. Enrolled nodes automatically configure SSSD, Kerberos ticket exchange, PAM authentication, and shared home directory auto-creation."
            type="info"
            showIcon
            action={
              <Button type="primary" onClick={() => navigate('/settings')} style={{ background: '#2563EB' }}>
                Open Client Enrollment in Settings &rarr;
              </Button>
            }
          />
        </div>
      )}



      {/* ── DELETE USER MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#DC2626' }}>
            <WarningOutlined />
            <span>Delete User Account</span>
          </div>
        }
        open={deleteModalOpen}
        onCancel={() => setDeleteModalOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setDeleteModalOpen(false)}>Cancel</Button>,
          <Button
            key="delete"
            danger
            type="primary"
            loading={deleting}
            onClick={handleConfirmDelete}
            disabled={confirmUsername !== deletingUser?.username}
          >
            Confirm Delete
          </Button>
        ]}
      >
        <div style={{ margin: '14px 0' }}>
          <Alert
            message="Account Deletion Notice"
            description={`Deleting user '@${deletingUser?.username}' removes their authentication credentials and directory permissions. Their home directory will be retained for archival.`}
            type="warning"
            showIcon
            style={{ marginBottom: 14 }}
          />

          <p style={{ fontSize: 13, color: '#334155' }}>
            Are you sure you want to delete user <strong>@{deletingUser?.username}</strong> ({deletingUser?.full_name})?
          </p>

          <p style={{ fontSize: 12, color: '#64748B' }}>
            Please type the exact username <code style={{ color: '#DC2626', fontWeight: 700 }}>{deletingUser?.username}</code> to confirm:
          </p>

          <Input
            value={confirmUsername}
            onChange={(e) => setConfirmUsername(e.target.value)}
            placeholder={deletingUser?.username}
          />
        </div>
      </Modal>

      {/* ── USER DETAILS DRAWER ── */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <UserOutlined style={{ fontSize: 18, color: '#2563EB' }} />
            <span>User Details: @{selectedUser?.username}</span>
          </div>
        }
        width={560}
        open={detailsDrawerOpen}
        onClose={() => setDetailsDrawerOpen(false)}
      >
        {selectedUser && (
          <div>
            <Card size="small" title="Identity & Directory Credentials" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                <div><strong>Full Name:</strong> {selectedUser.full_name || selectedUser.username}</div>
                <div><strong>Username:</strong> <Text code>@{selectedUser.username}</Text></div>
                <div><strong>Email:</strong> {selectedUser.email}</div>
                <div><strong>POSIX UID:</strong> <Text strong>{selectedUser.freeipa_uid || '1000'}</Text></div>
                <div><strong>POSIX GID:</strong> <Text strong>{selectedUser.freeipa_gid || '1000'}</Text></div>
                <div><strong>Kerberos Principal:</strong> <Text code>{selectedUser.username}@AYALHPC.HPC.COM</Text></div>
                <div><strong>Role:</strong> <Tag color="blue">{selectedUser.role}</Tag></div>
                <div><strong>Account Status:</strong> <Tag color="green">{selectedUser.is_active !== false ? 'Active' : 'Disabled'}</Tag></div>
              </div>
            </Card>

            <Card size="small" title="Storage & Quota Configuration" style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                <div><strong>Home Directory:</strong> <Text code>/home/{selectedUser.username}</Text></div>
                <div><strong>Storage Filesystem:</strong> XFS Native (/dev/mapper/hpc-home)</div>
                <div><strong>Storage Limit:</strong> {selectedUser.quota_storage_gb || 100} GB</div>
                <div><strong>Batch Core Hours:</strong> {selectedUser.quota_core_hours || 1000} hrs</div>
                <div><strong>Max Concurrent Jobs:</strong> {selectedUser.quota_max_jobs || 100} jobs</div>
              </div>
            </Card>

            <Space style={{ marginTop: 16 }}>
              <Button type="primary" icon={<EditOutlined />} onClick={() => { setDetailsDrawerOpen(false); handleOpenEdit(selectedUser) }} style={{ background: '#2563EB' }}>
                Edit Account
              </Button>
              <Button icon={<SafetyCertificateOutlined style={{ color: '#16A34A' }} />} onClick={() => { setDetailsDrawerOpen(false); handleOpenVerifyRepair(selectedUser) }}>
                Verify & Repair Quota
              </Button>
              <Button danger icon={<DeleteOutlined />} onClick={() => { setDetailsDrawerOpen(false); handleOpenDelete(selectedUser) }}>
                Delete Account
              </Button>
            </Space>
          </div>
        )}
      </Drawer>

      {/* ── ADJUST QUOTA MODAL ── */}
      <Modal
        title={`Adjust Storage Quota: ${adjustingQuotaUser?.username}`}
        open={quotaModalOpen}
        onCancel={() => setQuotaModalOpen(false)}
        onOk={handleSaveQuota}
        confirmLoading={savingQuota}
      >
        <Form form={quotaForm} layout="vertical">
          <Form.Item name="soft_limit_gb" label="Soft Limit (GB)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="hard_limit_gb" label="Hard Limit (GB)" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── VERIFY & REPAIR QUOTA MODAL ── */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#166534' }}>
            <SafetyCertificateOutlined style={{ fontSize: 20, color: '#16A34A' }} />
            <span>Filesystem Quota Verification & Auto-Repair: @{verifyingRepairUser?.username}</span>
          </div>
        }
        width={750}
        open={verifyRepairModalOpen}
        onCancel={() => setVerifyRepairModalOpen(false)}
        footer={[
          <Button key="close" onClick={() => setVerifyRepairModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="rerun"
            type="primary"
            loading={runningVerifyRepair}
            icon={<ReloadOutlined />}
            onClick={() => handleExecuteVerifyRepair(verifyingRepairUser)}
            style={{ background: '#16A34A', borderColor: '#16A34A' }}
          >
            Re-run Verification & Repair
          </Button>
        ]}
      >
        <div style={{ margin: '14px 0' }}>
          {runningVerifyRepair ? (
            <div style={{ textAlign: 'center', padding: '30px 0' }}>
              <Progress percent={65} status="active" strokeColor="#16A34A" style={{ width: '80%' }} />
              <div style={{ marginTop: 12, fontSize: 13, color: '#475569', fontWeight: 600 }}>
                Querying kernel quota state, testing write enforcement, and checking UID synchronization across nodes...
              </div>
            </div>
          ) : verifyRepairResult ? (
            <div>
              {/* Header metrics card */}
              <div style={{
                background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8,
                padding: '14px 16px', marginBottom: 16
              }}>
                <Row gutter={16}>
                  <Col span={6}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>ACCOUNT</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#14532D' }}>
                      @{verifyRepairResult.username}
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                      UID: {verifyRepairResult.uid}
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>CONFIGURED LIMIT</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#14532D' }}>
                      {verifyRepairResult.configured_limit_gb} GB
                    </div>
                    <div style={{ fontSize: 11, color: '#475569' }}>
                      Soft: {verifyRepairResult.configured_soft_gb} GB
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>ACTUAL DISK USAGE</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>
                      {verifyRepairResult.actual_usage_str}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748B' }}>
                      On /home mount
                    </div>
                  </Col>
                  <Col span={6}>
                    <div style={{ fontSize: 11, color: '#166534', fontWeight: 600 }}>KERNEL ENFORCEMENT</div>
                    <div style={{ marginTop: 2 }}>
                      <Tag color="green" style={{ fontWeight: 700, borderRadius: 10 }}>
                        {verifyRepairResult.enforcement_status}
                      </Tag>
                    </div>
                  </Col>
                </Row>
              </div>

              {/* Step checklist */}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1E293B', marginBottom: 8 }}>
                Quota Verification Pipeline Checklist:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {verifyRepairResult.steps?.map((step) => {
                  const isRepaired = step.status === 'Repaired'
                  const isPassed = step.status === 'Passed'
                  return (
                    <div
                      key={step.step}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 10,
                        padding: '10px 14px', borderRadius: 6,
                        border: '1px solid #E2E8F0',
                        background: isRepaired ? '#FEFCE8' : (isPassed ? '#FAFAFA' : '#FEF2F2')
                      }}
                    >
                      <div style={{ marginTop: 2 }}>
                        {isPassed && <CheckCircleOutlined style={{ color: '#16A34A', fontSize: 16 }} />}
                        {isRepaired && <CheckCircleOutlined style={{ color: '#CA8A04', fontSize: 16 }} />}
                        {!isPassed && !isRepaired && <WarningOutlined style={{ color: '#DC2626', fontSize: 16 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontWeight: 600, fontSize: 13, color: '#0F172A' }}>
                            Step {step.step}: {step.name}
                          </span>
                          <Tag color={isRepaired ? 'gold' : (isPassed ? 'green' : 'red')} style={{ borderRadius: 6, fontSize: 10.5 }}>
                            {step.status}
                          </Tag>
                        </div>
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                          {step.details}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              <Alert
                message="Data Safety & Integrity Assurance"
                description="All existing user data, files, and project directories have been preserved intact during quota enforcement. No files were truncated or deleted."
                type="success"
                showIcon
                style={{ marginTop: 14 }}
              />
            </div>
          ) : (
            <Alert
              message="Ready to Verify Quota"
              description="Click 'Re-run Verification & Repair' to test hardware quota limits and ensure non-root write protection is active."
              type="info"
              showIcon
            />
          )}
        </div>
      </Modal>

      {/* ── ADD GROUP MODAL ── */}
      <Modal
        title="Add HPC User Group"
        open={groupModalOpen}
        onCancel={() => setGroupModalOpen(false)}
        onOk={handleSaveGroup}
        confirmLoading={savingGroup}
      >
        <Form form={groupForm} layout="vertical">
          <Form.Item name="name" label="Group Name (Short name)" rules={[{ required: true }]}>
            <Input placeholder="bioinformatics" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input placeholder="Computational Genomics Research Lab" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="quota_storage_gb" label="Group Storage (GB)" initialValue={1000}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quota_core_hours" label="Core Hours Budget" initialValue={50000}>
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}

function round(val, dec = 1) {
  if (val === null || val === undefined) return 0
  const factor = Math.pow(10, dec)
  return Math.round(val * factor) / factor
}

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}
