import React from 'react'
import { useState, useEffect } from 'react'
import { Button, Tag, Tooltip, message, Badge, Empty } from 'antd'
import {
  PlayCircleOutlined, StopOutlined, ReloadOutlined,
  SyncOutlined, CheckCircleOutlined, CloseCircleOutlined,
  CloudServerOutlined
} from '@ant-design/icons'
import api from '../services/api'

export default function ServicesPage() {
  const [services, setServices] = useState([])
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState({})
  const [lastUpdated, setLastUpdated] = useState(null)

  useEffect(() => {
    loadServices(true)
    // Poll real-time systemd service status every 2 seconds
    const interval = setInterval(() => loadServices(false), 2000)
    return () => clearInterval(interval)
  }, [])

  const loadServices = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const res = await api.get('/services')
      const data = res.data?.services || res.data || []
      // Filter out dcgm_exporter if present (CPU cluster)
      const filtered = data.filter(s => s.name !== 'dcgm_exporter')
      setServices(filtered)
      setLastUpdated(new Date().toLocaleTimeString())
    } catch (err) {
      console.error('Failed to load services:', err)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  const toggle = async (svc, action) => {
    const id = svc.id || svc.name
    const name = svc.name
    setActionLoading(prev => ({ ...prev, [name]: action }))
    try {
      const res = await api.post(`/services/${id}/${action}`)
      message.success(`Service '${name}' ${action}ed successfully`)
      await loadServices(false)
    } catch (err) {
      message.error(`Failed to ${action} service '${name}': ${err.response?.data?.detail || err.message}`)
    } finally {
      setActionLoading(prev => ({ ...prev, [name]: null }))
    }
  }

  const isRunning = (s) => {
    const st = s?.toLowerCase()
    return st === 'running' || st === 'active'
  }

  const runningCount = services.filter(s => isRunning(s.status)).length
  const stoppedCount = services.filter(s => !isRunning(s.status)).length

  return (
    <div>
      {/* ── HEADER STRIP ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, flexWrap: 'wrap', gap: 12
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#0F172A' }}>Services</span>
          <Tag color="success" style={{ fontWeight: 600 }}>{runningCount} Running</Tag>
          {stoppedCount > 0 && (
            <Tag color="error" style={{ fontWeight: 700 }}>{stoppedCount} Stopped</Tag>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748B' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'inline-block' }} />
            <span>Live check active (2s interval)</span>
            {lastUpdated && <span style={{ fontFamily: 'monospace' }}>• {lastUpdated}</span>}
          </div>

          <Button
            size="small"
            icon={<SyncOutlined spin={loading} />}
            onClick={() => loadServices(true)}
            style={{ borderRadius: 6 }}
          >
            Check Now
          </Button>
        </div>
      </div>

      {/* ── SERVICES CARDS GRID ── */}
      {services.length === 0 ? (
        <div style={{ padding: '48px 0', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid #E2E8F0' }}>
          <Empty description="No cluster service daemons registered. Service daemons (Slurm, Munge, FreeIPA, Chrony, NFS) will register here when cluster nodes are provisioned." />
        </div>
      ) : (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
        gap: 16
      }}>
        {services.map((svc) => {
          const active = isRunning(svc.status)
          const currentAction = actionLoading[svc.name]
          const hostLabel = svc.node_hostname || 'Controller'

          return (
            <div
              key={svc.id || svc.name}
              style={{
                background: '#FFFFFF',
                borderRadius: 10,
                border: active ? '1px solid #E2E8F0' : '1.5px solid #FCA5A5',
                boxShadow: active ? '0 1px 3px rgba(0,0,0,0.03)' : '0 2px 8px rgba(239,68,68,0.1)',
                overflow: 'hidden',
                transition: 'all 0.2s',
              }}
            >
              {/* Card Header */}
              <div style={{
                padding: '12px 16px',
                background: active ? '#F8FAFC' : '#FEF2F2',
                borderBottom: `1px solid ${active ? '#E2E8F0' : '#FECACA'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: active ? '#0F172A' : '#DC2626' }}>
                    {svc.name}
                  </span>
                  <Tag style={{ fontSize: 10.5, borderRadius: 4, margin: 0 }}>
                    {svc.unit || `${svc.name}.service`}
                  </Tag>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 9, height: 9, borderRadius: '50%',
                    background: active ? '#16A34A' : '#DC2626',
                    boxShadow: active ? '0 0 6px rgba(22,163,74,0.6)' : '0 0 6px rgba(220,38,38,0.6)'
                  }} />
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: active ? '#16A34A' : '#DC2626'
                  }}>
                    {active ? 'running' : 'stopped'}
                  </span>
                </div>
              </div>

              {/* Card Body */}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Display Name:</span>
                    <span style={{ fontWeight: 600, color: '#1E293B' }}>{svc.display_name || svc.name}</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Target Node:</span>
                    <span style={{
                      fontWeight: 600, color: '#2563EB',
                      display: 'flex', alignItems: 'center', gap: 4
                    }}>
                      <CloudServerOutlined style={{ fontSize: 13 }} />
                      {hostLabel}
                    </span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Manager:</span>
                    <span style={{ fontWeight: 600, color: '#475569' }}>systemd</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#64748B' }}>Last Probed:</span>
                    <span style={{ color: '#94A3B8', fontSize: 11.5 }}>
                      {svc.last_check ? new Date(svc.last_check).toLocaleTimeString() : 'Just now'}
                    </span>
                  </div>
                </div>

                {/* Control Action Buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F1F5F9' }}>
                  <Button
                    size="small"
                    type={!active ? 'primary' : 'default'}
                    icon={<PlayCircleOutlined />}
                    disabled={active || currentAction !== null && currentAction !== undefined}
                    loading={currentAction === 'start'}
                    onClick={() => toggle(svc, 'start')}
                    style={{
                      flex: 1,
                      background: !active ? '#16A34A' : '#fff',
                      color: !active ? '#fff' : (active ? '#94A3B8' : '#16A34A'),
                      borderColor: !active ? '#16A34A' : '#D1D5DB',
                      fontWeight: 600, fontSize: 12, borderRadius: 6
                    }}
                  >
                    Start
                  </Button>

                  <Button
                    size="small"
                    type={active ? 'primary' : 'default'}
                    danger
                    icon={<StopOutlined />}
                    disabled={!active || currentAction !== null && currentAction !== undefined}
                    loading={currentAction === 'stop'}
                    onClick={() => toggle(svc, 'stop')}
                    style={{
                      flex: 1,
                      fontWeight: 600, fontSize: 12, borderRadius: 6
                    }}
                  >
                    Stop
                  </Button>

                  <Button
                    size="small"
                    icon={<ReloadOutlined />}
                    disabled={currentAction !== null && currentAction !== undefined}
                    loading={currentAction === 'restart'}
                    onClick={() => toggle(svc, 'restart')}
                    style={{
                      flex: 1,
                      fontWeight: 600, fontSize: 12, borderRadius: 6,
                      borderColor: '#93C5FD', color: '#2563EB'
                    }}
                  >
                    Restart
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
