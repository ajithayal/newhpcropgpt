import React from 'react'
import { useState, useEffect } from 'react'
import InfoCard from '../components/ui/InfoCard'
import api from '../services/api'

export default function AuditLogsPage() {
  const [logs, setLogs] = useState([])

  useEffect(() => { loadLogs() }, [])

  const loadLogs = async () => {
    try {
      const res = await api.get('/audit-logs')
      setLogs(res.data?.logs || res.data || [])
    } catch (err) { console.error(err) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Audit Logs</span>
      </div>
      <InfoCard title="Admin Action Log">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--head-bg)', borderBottom: '1px solid var(--card-border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Time</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>User</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Action</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Resource</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log, i) => (
                <tr key={log.id || i} style={{ borderBottom: '1px solid #F1F3F7' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--muted)' }}>
                    {new Date(log.created_at || log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{log.user || log.username || (log.user_id ? String(log.user_id).slice(0, 8) : '-')}</td>
                  <td style={{ padding: '6px 10px' }}>{log.action}</td>
                  <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{log.resource_type || log.resource || '-'}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--muted)' }}>{log.ip_address || log.ip || '-'}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan={5} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No audit logs</td></tr>}
            </tbody>
          </table>
        </div>
      </InfoCard>
    </>
  )
}
