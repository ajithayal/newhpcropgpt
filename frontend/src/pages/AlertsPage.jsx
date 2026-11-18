import React from 'react'
import { useState, useEffect } from 'react'
import InfoCard from '../components/ui/InfoCard'
import api from '../services/api'
import { Tabs, Tag, Popconfirm, message } from 'antd'

export default function AlertsPage() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadAlerts() }, [])

  const loadAlerts = async () => {
    try {
      const res = await api.get('/alerts')
      setAlerts(res.data?.items || res.data?.alerts || res.data || [])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const acknowledge = async (id) => {
    try { await api.put(`/alerts/${id}/acknowledge`); message.success('Acknowledged'); loadAlerts() }
    catch { message.error('Failed') }
  }

  const resolve = async (id) => {
    try { await api.put(`/alerts/${id}/resolve`); message.success('Resolved'); loadAlerts() }
    catch { message.error('Failed') }
  }

  const getColor = (level) => {
    const c = { critical: 'red', error: 'red', warning: 'orange', info: 'blue', resolved: 'green' }
    return c[level] || 'default'
  }

  const tabItems = [
    {
      key: 'all', label: 'All',
      children: (
        <div style={{ border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--head-bg)', borderBottom: '1px solid var(--card-border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Time</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Level</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Message</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Source</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid #F1F3F7' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {new Date(a.created_at || a.timestamp).toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '6px 10px' }}><Tag color={getColor(a.level || a.severity)}>{(a.level || a.severity || 'info').toUpperCase()}</Tag></td>
                  <td style={{ padding: '6px 10px' }}>{a.message || a.title}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{a.source || '-'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                    {!(a.is_acknowledged ?? a.acknowledged) && <button onClick={() => acknowledge(a.id)} style={{ padding: '2px 8px', fontSize: 10, border: '1px solid var(--accent)', borderRadius: 4, background: '#fff', color: 'var(--accent)', cursor: 'pointer', marginRight: 4 }}>Ack</button>}
                    {!(a.is_resolved ?? a.resolved) && <button onClick={() => resolve(a.id)} style={{ padding: '2px 8px', fontSize: 10, border: '1px solid var(--green)', borderRadius: 4, background: '#fff', color: 'var(--green)', cursor: 'pointer' }}>Resolve</button>}
                  </td>
                </tr>
              ))}
              {alerts.length === 0 && <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No alerts</td></tr>}
            </tbody>
          </table>
        </div>
      ),
    },
  ]

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Incidents & Events</span>
      </div>
      <Tabs items={tabItems} />
    </>
  )
}
