import React from 'react'
import { useState, useEffect } from 'react'
import InfoCard from '../components/ui/InfoCard'
import { KVRow } from '../components/ui/Shared'
import api from '../services/api'

export default function NetworkPage() {
  const [interfaces, setInterfaces] = useState([])

  useEffect(() => { loadNetwork() }, [])

  const loadNetwork = async () => {
    try {
      const res = await api.get('/network')
      setInterfaces(res.data?.interfaces || res.data || [])
    } catch (err) { console.error(err) }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Network View</span>
      </div>
      <InfoCard title="Network Interfaces">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--head-bg)', borderBottom: '1px solid var(--card-border)' }}>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>Interface</th>
                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 700 }}>IP</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>RX</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>TX</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Errors</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Drops</th>
                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {interfaces.map((iface, i) => (
                <tr key={iface.name || i} style={{ borderBottom: '1px solid #F1F3F7' }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>{iface.name}</td>
                  <td style={{ padding: '6px 10px' }}>{iface.ip || '-'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{iface.rx || '0 Mbps'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{iface.tx || '0 Mbps'}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: iface.errors > 0 ? 'var(--red)' : 'var(--green)' }}>{iface.errors || 0}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: iface.drops > 0 ? 'var(--orange)' : 'var(--green)' }}>{iface.drops || 0}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right', color: iface.status === 'up' ? 'var(--green)' : 'var(--red)' }}>{iface.status || 'up'}</td>
                </tr>
              ))}
              {interfaces.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
                    No network interfaces detected
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </InfoCard>
    </>
  )
}
