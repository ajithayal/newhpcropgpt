import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Select, Tag, Button, Dropdown } from 'antd'
import {
  DesktopOutlined, SettingOutlined, DatabaseOutlined, AppstoreOutlined,
  CalendarOutlined, HddOutlined, SafetyCertificateOutlined,
  ThunderboltOutlined, FileTextOutlined, PlusOutlined,
} from '@ant-design/icons'
import api from '../../services/api'

const { Option } = Select

export const CLUSTER_PRIMARY_TABS = [
  { id: 'overview', path: '/cluster/overview', icon: <DesktopOutlined />, label: 'Overview' },
  { id: 'nodes', path: '/cluster/nodes', icon: <DatabaseOutlined />, label: 'Nodes' },
  { id: 'config', path: '/cluster/config', icon: <SettingOutlined />, label: 'Configuration' },
  { id: 'apps', path: '/cluster/apps', icon: <AppstoreOutlined />, label: 'HPC Applications' },
  { id: 'jobs', path: '/cluster/jobs', icon: <CalendarOutlined />, label: 'Job Scheduler' },
  { id: 'storage', path: '/cluster/storage', icon: <HddOutlined />, label: 'Storage' },
]

export const CLUSTER_MORE_ITEMS = [
  { key: 'identity', label: 'Identity & Access (FreeIPA)', icon: <SafetyCertificateOutlined />, path: '/cluster/identity' },
  { key: 'services', label: 'Services & Health', icon: <ThunderboltOutlined />, path: '/cluster/services' },
  { key: 'activity', label: 'Cluster Activity & Logs', icon: <FileTextOutlined />, path: '/cluster/activity' },
]

export default function ClusterNavHeader({ title, subtitle, onAddNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [clusters, setClusters] = useState([])
  const [selectedClusterId, setSelectedClusterId] = useState(null)

  useEffect(() => {
    api.get('/cluster-mgmt/clusters/overview').then((res) => {
      const list = res.data?.clusters || (Array.isArray(res.data) ? res.data : [])
      if (list.length > 0) {
        setClusters(list)
        if (!selectedClusterId || !list.find((c) => c.id === selectedClusterId)) {
          setSelectedClusterId(list[0].id)
        }
      } else {
        setClusters([])
        setSelectedClusterId(null)
      }
    }).catch(() => {
      setClusters([])
      setSelectedClusterId(null)
    })
  }, [])

  const currentPath = location.pathname

  const isMoreActive = CLUSTER_MORE_ITEMS.some((item) => currentPath.startsWith(item.path))
  const activeMoreItem = CLUSTER_MORE_ITEMS.find((item) => currentPath.startsWith(item.path))

  const moreDropdownMenu = {
    items: CLUSTER_MORE_ITEMS.map((item) => ({
      key: item.key,
      icon: item.icon,
      label: (
        <span style={{ fontWeight: currentPath.startsWith(item.path) ? 700 : 500 }}>
          {item.label}
        </span>
      ),
      onClick: () => navigate(item.path),
    })),
  }

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) || null

  return (
    <div style={{
      background: '#FFFFFF',
      borderBottom: '1px solid #E2E8F0',
      padding: '16px 20px 0 20px',
      marginBottom: 16,
      borderRadius: '8px 8px 0 0',
    }}>
      {/* ── Top Header Row ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
                {title || 'Cluster Workspace'}
              </span>
              {selectedCluster && (
                <span className="ayal-accent-badge">
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#EAB308', display: 'inline-block' }} />
                  {selectedCluster.name}
                </span>
              )}
            </div>
            {subtitle && (
              <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                {subtitle}
              </div>
            )}
          </div>

          {/* Cluster Switcher */}
          {clusters.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <span style={{ fontSize: 11, color: '#64748B', fontWeight: 600 }}>Cluster:</span>
              <Select
                size="small"
                value={selectedClusterId}
                onChange={(val) => setSelectedClusterId(val)}
                style={{ width: 170 }}
              >
                {clusters.map((c) => (
                  <Option key={c.id} value={c.id}>
                    {c.name}
                  </Option>
                ))}
              </Select>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8 }}>
              <Tag color="default">No Active Clusters</Tag>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {onAddNode && (
            <Button
              type="primary"
              size="middle"
              icon={<PlusOutlined />}
              onClick={onAddNode}
              style={{ background: '#2563EB', fontWeight: 600 }}
            >
              Add Node
            </Button>
          )}
          <Button
            size="middle"
            onClick={() => navigate('/cluster/create')}
            style={{ fontWeight: 500 }}
          >
            + Create Cluster
          </Button>
        </div>
      </div>

      {/* ── Tab Strip ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        overflowX: 'auto',
        borderBottom: '1px solid #E2E8F0',
        margin: '0 -20px',
        padding: '0 20px',
      }}>
        {CLUSTER_PRIMARY_TABS.map((tab) => {
          const isActive = currentPath === tab.path || (tab.id === 'overview' && currentPath === '/cluster')
          return (
            <div
              key={tab.id}
              onClick={() => navigate(tab.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 14px',
                fontSize: 12.5,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#2563EB' : '#64748B',
                borderBottom: isActive ? '2.5px solid #2563EB' : '2.5px solid transparent',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = '#0F172A'
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = '#64748B'
              }}
            >
              <span style={{ fontSize: 13, display: 'flex', alignItems: 'center' }}>
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </div>
          )
        })}

        {/* More Services Dropdown */}
        <Dropdown menu={moreDropdownMenu} trigger={['click']} placement="bottomLeft">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '9px 14px',
              fontSize: 12.5,
              fontWeight: isMoreActive ? 700 : 500,
              color: isMoreActive ? '#2563EB' : '#64748B',
              borderBottom: isMoreActive ? '2.5px solid #2563EB' : '2.5px solid transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
          >
            <span>More Services</span>
            <span style={{ fontSize: 10 }}>▾</span>
            {isMoreActive && activeMoreItem && (
              <Tag color="blue" style={{ margin: 0, padding: '0 6px', fontSize: 10 }}>
                {activeMoreItem.label.split(' ')[0]}
              </Tag>
            )}
          </div>
        </Dropdown>
      </div>
    </div>
  )
}
