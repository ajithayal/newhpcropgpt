import React from 'react'
export function KVRow({ label, value, valueColor, valueStyle = {} }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0',
      fontSize: 12.5, borderBottom: '1px dashed #F1F5F9',
    }}>
      <span style={{ color: '#64748B' }}>{label}</span>
      <span className="tabular-nums" style={{
        fontWeight: 600, textAlign: 'right',
        color: valueColor || '#0F172A',
        ...valueStyle,
      }}>{value}</span>
    </div>
  )
}

export function AlertLine({ color, time, message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderBottom: '1px solid #F1F5F9', fontSize: 12 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', marginTop: 5, flex: 'none', background: color }} />
      <span className="tabular-nums" style={{ color: '#94A3B8', whiteSpace: 'nowrap', fontFamily: 'var(--mono)', fontSize: 11 }}>{time}</span>
      <span style={{ color: '#334155' }}>{message}</span>
    </div>
  )
}

export function StatusTag({ status }) {
  const normalized = (status || 'unknown').toLowerCase()
  const map = {
    online: { label: 'Online', color: '#16A34A', bg: '#DCFCE7' },
    healthy: { label: 'Healthy', color: '#16A34A', bg: '#DCFCE7' },
    active: { label: 'Active', color: '#16A34A', bg: '#DCFCE7' },
    ok: { label: 'OK', color: '#16A34A', bg: '#DCFCE7' },
    idle: { label: 'Idle', color: '#2563EB', bg: '#EFF6FF' },
    allocated: { label: 'Allocated', color: '#2563EB', bg: '#EFF6FF' },
    warning: { label: 'Warning', color: '#D97706', bg: '#FEF3C7' },
    maintenance: { label: 'Maintenance', color: '#D97706', bg: '#FEF3C7' },
    drain: { label: 'Drain', color: '#D97706', bg: '#FEF3C7' },
    offline: { label: 'Offline', color: '#DC2626', bg: '#FEE2E2' },
    down: { label: 'Down', color: '#DC2626', bg: '#FEE2E2' },
    failed: { label: 'Failed', color: '#DC2626', bg: '#FEE2E2' },
  }
  const item = map[normalized] || { label: status || 'Unknown', color: '#64748B', bg: '#F1F5F9' }

  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 4, background: item.bg,
      color: item.color, fontSize: 11.5, fontWeight: 600,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.color }} />
      {item.label}
    </span>
  )
}
