import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Dropdown, Badge, Popover, Button, Tag, Empty, Drawer, message, Tooltip, Input } from 'antd'
import {
  DownOutlined, RightOutlined, DashboardOutlined, ClusterOutlined,
  UserOutlined, SettingOutlined, CloudServerOutlined, PlusOutlined,
  DatabaseOutlined, LineChartOutlined, HddOutlined, FolderOutlined,
  AlertOutlined, SafetyCertificateOutlined, FileTextOutlined,
  CalendarOutlined, SearchOutlined, BellOutlined, CloseCircleOutlined,
  WarningOutlined, InfoCircleOutlined, CheckCircleOutlined, ThunderboltOutlined,
  SyncOutlined, CodeOutlined, DesktopOutlined, AppstoreOutlined, MenuOutlined,
  ApiOutlined
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import api from '../services/api'

export default function MainLayout({ children }) {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [isTablet, setIsTablet] = useState(false)
  const [clusterName, setClusterName] = useState('AYAL HPC')

  const navigate = useNavigate()
  const location = useLocation()
  const { user, logout, fetchCurrentUser } = useAuthStore()

  // Always refresh live user profile from server on mount
  useEffect(() => {
    if (fetchCurrentUser) {
      fetchCurrentUser()
    }
  }, [fetchCurrentUser])

  // Track responsive screen size
  useEffect(() => {
    const handleResize = () => {
      const w = window.innerWidth
      setIsMobile(w < 768)
      setIsTablet(w >= 768 && w < 1024)
      if (w < 1024 && !collapsed) {
        setCollapsed(true)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const initials = user?.full_name?.trim()
    ? user.full_name
        .trim()
        .split(/\s+/)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : user?.username?.slice(0, 2)?.toUpperCase() || 'AD'

  // Alerts state & live polling every 3s
  const [alerts, setAlerts] = useState([])
  const [alertOpen, setAlertOpen] = useState(false)

  const activeAlerts = alerts.filter(a => !a.is_resolved)

  const fetchAlerts = async () => {
    try {
      const res = await api.get('/alerts', { params: { limit: 50 } })
      const list = Array.isArray(res.data) ? res.data : (res.data?.items || res.data?.alerts || [])
      setAlerts(list)
    } catch (err) {}
  }

  useEffect(() => {
    fetchAlerts()
    const timer = setInterval(fetchAlerts, 3000)
    return () => clearInterval(timer)
  }, [])

  const handleResolveAlert = async (id) => {
    try {
      await api.put(`/alerts/${id}/resolve`)
      message.success('Alert resolved')
      fetchAlerts()
    } catch (err) {
      message.error('Failed to resolve alert')
    }
  }

  const handleResolveAllAlerts = async () => {
    try {
      await api.post('/alerts/resolve-all')
      message.success('All active alerts marked resolved')
      fetchAlerts()
    } catch (err) {
      message.error('Failed to resolve alerts')
    }
  }

  // Load cluster name from backend
  useEffect(() => {
    api.get('/clusters').then((res) => {
      const cl = res.data
      if (Array.isArray(cl) && cl.length > 0) setClusterName(cl[0].name)
    }).catch(() => {})
  }, [])

  const alertPopoverContent = (
    <div style={{ width: 360, maxHeight: 420, overflowY: 'auto' }}>
      {activeAlerts.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<span style={{ fontSize: 12, color: '#64748B' }}>No active alerts. All HPC cluster services healthy.</span>}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {activeAlerts.map((a) => {
            const isCrit = a.level === 'critical' || a.level === 'error'
            const isWarn = a.level === 'warning'
            return (
              <div
                key={a.id}
                style={{
                  padding: '10px 12px',
                  borderRadius: 6,
                  background: isCrit ? '#FEF2F2' : isWarn ? '#FFFBEB' : '#F8FAFC',
                  border: `1px solid ${isCrit ? '#FECACA' : isWarn ? '#FDE68A' : '#E2E8F0'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isCrit ? (
                      <CloseCircleOutlined style={{ color: '#DC2626', fontSize: 14 }} />
                    ) : isWarn ? (
                      <WarningOutlined style={{ color: '#D97706', fontSize: 14 }} />
                    ) : (
                      <InfoCircleOutlined style={{ color: '#2563EB', fontSize: 14 }} />
                    )}
                    <span style={{ fontWeight: 700, fontSize: 12, color: '#0F172A' }}>
                      {a.title}
                    </span>
                  </div>
                  <Tag color={isCrit ? 'error' : isWarn ? 'warning' : 'default'} style={{ margin: 0, fontSize: 10 }}>
                    {a.level?.toUpperCase()}
                  </Tag>
                </div>
                <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                  {a.message}
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginTop: 8, paddingTop: 6, borderTop: '1px solid rgba(0,0,0,0.05)', fontSize: 10.5, color: '#94A3B8'
                }}>
                  <span>{new Date(a.created_at || Date.now()).toLocaleTimeString()}</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Button size="small" type="link" onClick={() => handleResolveAlert(a.id)} style={{ fontSize: 11, padding: 0 }}>
                      Resolve
                    </Button>
                    <Button size="small" type="link" onClick={() => { setAlertOpen(false); navigate('/cluster/health') }} style={{ fontSize: 11, padding: 0, color: '#2563EB' }}>
                      Health &rarr;
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <div style={{
        marginTop: 10, paddingTop: 8, borderTop: '1px solid #E2E8F0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
      }}>
        <Button size="small" type="text" onClick={() => { setAlertOpen(false); navigate('/cluster/health') }} style={{ fontSize: 11, color: '#2563EB' }}>
          ⚡ Cluster Health
        </Button>
        <Button size="small" type="text" onClick={fetchAlerts} style={{ fontSize: 11, color: '#64748B' }}>
          🔄 Refresh
        </Button>
      </div>
    </div>
  )

  const p = location.pathname
  const isDashboardActive = p === '/' || p === '/dashboard'
  const isClusterActive = p.startsWith('/cluster') || p === '/cluster-setup' || p.startsWith('/nodes')
  const isStorageActive = p.startsWith('/storage') || p.startsWith('/cluster/storage')
  const isAgentsActive = p.startsWith('/agents')
  const isAccountActive = p.startsWith('/users') || p.startsWith('/audit-logs')
  const isAppsActive = p.startsWith('/packages') || p.startsWith('/cluster/apps')
  const isJobsActive = p.startsWith('/jobs') || p.startsWith('/cluster/jobs')
  const isPowerActive = p.startsWith('/operations') || location.search.includes('tab=power')
  const isSettingsActive = p.startsWith('/settings') || p.startsWith('/database')

  // The 9 Main Navigation Items in Master Required Order:
  // 1. Dashboard, 2. Cluster, 3. Storage, 4. Agents, 5. Account, 6. Application Management, 7. Jobs, 8. Power, 9. Settings
  const mainNavigationItems = [
    {
      key: 'dashboard',
      label: 'Dashboard',
      icon: <DashboardOutlined style={{ fontSize: 16 }} />,
      path: '/',
      active: isDashboardActive,
    },
    {
      key: 'cluster',
      label: 'Cluster',
      icon: <ClusterOutlined style={{ fontSize: 16 }} />,
      path: '/cluster',
      active: isClusterActive,
    },
    {
      key: 'storage',
      label: 'Storage',
      icon: <HddOutlined style={{ fontSize: 16 }} />,
      path: '/cluster/storage',
      active: isStorageActive,
    },
    {
      key: 'agents',
      label: 'Agents',
      icon: <ApiOutlined style={{ fontSize: 16 }} />,
      path: '/agents',
      active: isAgentsActive,
    },
    {
      key: 'account',
      label: 'Account',
      icon: <UserOutlined style={{ fontSize: 16 }} />,
      path: '/users',
      active: isAccountActive,
    },
    {
      key: 'apps',
      label: 'Application Management',
      icon: <AppstoreOutlined style={{ fontSize: 16 }} />,
      path: '/packages',
      active: isAppsActive,
    },
    {
      key: 'jobs',
      label: 'Jobs',
      icon: <CalendarOutlined style={{ fontSize: 16 }} />,
      path: '/jobs',
      active: isJobsActive,
    },
    {
      key: 'power',
      label: 'Power',
      icon: <ThunderboltOutlined style={{ fontSize: 16 }} />,
      path: '/operations?tab=power',
      active: isPowerActive,
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: <SettingOutlined style={{ fontSize: 16 }} />,
      path: '/settings',
      active: isSettingsActive,
    },
  ]

  const handleNavClick = (path) => {
    navigate(path)
    if (isMobile) setMobileDrawerOpen(false)
  }

  // Sidebar Component JSX
  const renderSidebarContent = () => (
    <div style={{
      height: '100%',
      background: '#101B33',
      color: '#94A3B8',
      display: 'flex',
      flexDirection: 'column',
      userSelect: 'none',
      borderRight: '1px solid #1E293B',
    }}>
      {/* Brand Header inside Sidebar for Drawer or Desktop */}
      <div style={{
        height: 64,
        display: 'flex',
        alignItems: 'center',
        padding: collapsed && !isMobile ? '0 18px' : '0 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
      }}>
        <div
          onClick={() => handleNavClick('/')}
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 10 }}
        >
          {collapsed && !isMobile ? (
            <img
              src="/app-icon.png"
              alt="AYAL HPC"
              style={{ height: 32, width: 32, borderRadius: 6, objectFit: 'contain' }}
              onError={(e) => { e.currentTarget.src = '/logo.svg' }}
            />
          ) : (
            <img
              src="/ayal-hpc-logo-dark.png"
              alt="AYAL HPC MANAGER"
              style={{
                height: 34,
                maxHeight: 34,
                maxWidth: 195,
                objectFit: 'contain',
                display: 'block',
              }}
              onError={(e) => { e.currentTarget.src = '/ayal-hpc-logo.png' }}
            />
          )}
        </div>
      </div>

      {/* Main 7 Navigation Links */}
      <div style={{ flex: 1, padding: '16px 0', overflowY: 'auto' }}>
        <div style={{
          padding: '0 18px 8px', fontSize: 10.5, fontWeight: 700,
          color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.06em'
        }}>
          {(!collapsed || isMobile) && 'Infrastructure Orchestration'}
        </div>

        {mainNavigationItems.map((item) => {
          const itemActive = item.active
          return (
            <Tooltip
              key={item.key}
              title={collapsed && !isMobile ? item.label : ''}
              placement="right"
            >
              <div
                onClick={() => handleNavClick(item.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: collapsed && !isMobile ? '12px 0' : '11px 20px',
                  justifyContent: collapsed && !isMobile ? 'center' : 'flex-start',
                  fontSize: 13,
                  cursor: 'pointer',
                  borderLeft: `3px solid ${itemActive ? '#2563EB' : 'transparent'}`,
                  background: itemActive ? 'rgba(37, 99, 235, 0.16)' : 'transparent',
                  color: itemActive ? '#FFFFFF' : '#94A3B8',
                  fontWeight: itemActive ? 700 : 500,
                  transition: 'all 0.15s ease',
                  margin: '2px 0',
                }}
                onMouseEnter={(e) => {
                  if (!itemActive) {
                    e.currentTarget.style.color = '#FFFFFF'
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!itemActive) {
                    e.currentTarget.style.color = '#94A3B8'
                    e.currentTarget.style.background = 'transparent'
                  }
                }}
              >
                <span style={{ color: itemActive ? '#38BDF8' : 'inherit', display: 'flex', alignItems: 'center' }}>
                  {item.icon}
                </span>
                {(!collapsed || isMobile) && <span>{item.label}</span>}
              </div>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )

  const sidebarWidth = collapsed ? 72 : 250

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: '#F5F7FB',
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    }}>
      {/* ── DESKTOP PERSISTENT SIDEBAR (#101B33) ── */}
      {!isMobile && (
        <div style={{
          width: sidebarWidth,
          height: '100vh',
          flexShrink: 0,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          zIndex: 20,
        }}>
          {renderSidebarContent()}
        </div>
      )}

      {/* ── MOBILE / TABLET SLIDING DRAWER ── */}
      {isMobile && (
        <Drawer
          placement="left"
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          width={260}
          bodyStyle={{ padding: 0 }}
          headerStyle={{ display: 'none' }}
        >
          {renderSidebarContent()}
        </Drawer>
      )}

      {/* ── MAIN CONTENT WRAPPER ── */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        minWidth: 0,
      }}>
        {/* ── TOP NAVIGATION (Height: 64px, Light Enterprise: #FFFFFF) ── */}
        <header style={{
          height: 64,
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: isMobile ? '0 12px' : '0 24px',
          flexShrink: 0,
          zIndex: 10,
          boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
        }}>
          {/* Left section: Hamburger / Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Button
              type="text"
              icon={<MenuOutlined style={{ fontSize: 16, color: '#334155' }} />}
              onClick={() => {
                if (isMobile) {
                  setMobileDrawerOpen(true)
                } else {
                  setCollapsed(!collapsed)
                }
              }}
              style={{
                width: 36,
                height: 36,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
              }}
              title="Toggle Sidebar"
            />
          </div>

          {/* Center search (desktop only) */}
          {!isMobile && !isTablet && (
            <div style={{ flex: 1, maxWidth: 420, margin: '0 24px' }}>
              <Input
                placeholder="Search cluster, nodes, storage, jobs..."
                prefix={<SearchOutlined style={{ color: '#94A3B8', fontSize: 14 }} />}
                style={{
                  borderRadius: 8,
                  background: '#F8FAFC',
                  border: '1px solid #E2E8F0',
                  fontSize: 12.5,
                  padding: '6px 12px',
                }}
              />
            </div>
          )}

          {/* Right section: System Alerts, Actions & Admin Profile */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Alert Notification Bell with Real Badge Count */}
            <Popover
              content={alertPopoverContent}
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>
                    System Alerts ({activeAlerts.length})
                  </span>
                  {activeAlerts.length > 0 && (
                    <Button size="small" type="link" onClick={handleResolveAllAlerts} style={{ fontSize: 11, padding: 0 }}>
                      Resolve All
                    </Button>
                  )}
                </div>
              }
              trigger="click"
              placement="bottomRight"
              open={alertOpen}
              onOpenChange={setAlertOpen}
            >
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 36, height: 36, borderRadius: 8,
                background: activeAlerts.length > 0 ? '#FEE2E2' : '#F1F5F9',
                border: activeAlerts.length > 0 ? '1px solid #FECACA' : '1px solid #E2E8F0',
                cursor: 'pointer', transition: 'all 0.15s ease', position: 'relative'
              }}>
                <Badge count={activeAlerts.length} size="small" overflowCount={99} offset={[2, -4]}>
                  <BellOutlined style={{
                    fontSize: 16,
                    color: activeAlerts.length > 0 ? '#DC2626' : '#64748B'
                  }} />
                </Badge>
              </div>
            </Popover>

            {/* Quick Action: New Cluster Button (Desktop) */}
            {!isMobile && (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => navigate('/cluster-setup')}
                style={{
                  background: '#2563EB',
                  borderColor: '#2563EB',
                  fontWeight: 600,
                  borderRadius: 6,
                  height: 36,
                  fontSize: 12.5,
                }}
              >
                Create Cluster
              </Button>
            )}

            {/* User Profile Dropdown */}
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'user-info',
                    label: (
                      <div>
                        <div style={{ fontWeight: 700, color: '#0F172A' }}>
                          {user?.full_name || user?.username || 'admin'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748B' }}>
                          Super Administrator
                        </div>
                      </div>
                    ),
                    disabled: true,
                  },
                  { type: 'divider' },
                  { key: 'account', label: 'User & Identity Profile', icon: <UserOutlined />, onClick: () => navigate('/users') },
                  { key: 'settings', label: 'System Settings', icon: <SettingOutlined />, onClick: () => navigate('/settings') },
                  { key: 'health', label: 'Cluster Health Audit', icon: <SafetyCertificateOutlined />, onClick: () => navigate('/cluster/health') },
                  { type: 'divider' },
                  { key: 'logout', label: 'Sign Out', danger: true, onClick: () => { logout(); navigate('/login') } },
                ],
              }}
              placement="bottomRight"
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: '#F8FAFC', padding: '4px 10px',
                borderRadius: 20, fontSize: 12.5, cursor: 'pointer',
                border: '1px solid #E2E8F0', transition: 'background 0.15s ease'
              }}>
                <span style={{
                  width: 26, height: 26, borderRadius: '50%',
                  background: 'linear-gradient(135deg, #2563EB, #1D4ED8)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: '#FFFFFF', flexShrink: 0,
                }}>{initials}</span>
                {!isMobile && (
                  <span style={{ fontWeight: 600, color: '#172033' }}>
                    {user?.full_name || user?.username || 'admin'} ▾
                  </span>
                )}
              </div>
            </Dropdown>
          </div>
        </header>

        {/* ── MAIN APPLICATION CANVAS (#F5F7FB) ── */}
        <main style={{
          flex: 1,
          overflowY: 'auto',
          background: '#F5F7FB',
          padding: isMobile ? '14px 12px' : '20px 28px',
        }}>
          {children}
        </main>
      </div>
    </div>
  )
}
