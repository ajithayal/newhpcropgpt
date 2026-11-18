import React from 'react'
export default function InfoCard({ title, children, style = {}, selected = false, onRefresh, onMaximize, rowSpan }) {
  return (
    <div style={{
      background: '#FFFFFF',
      border: `1px solid ${selected ? '#2563EB' : '#E2E8F0'}`,
      borderRadius: 8,
      overflow: 'hidden',
      boxShadow: selected ? '0 0 0 2px rgba(37, 99, 235, 0.15)' : '0 1px 3px rgba(0, 0, 0, 0.04)',
      gridRow: rowSpan ? `span ${rowSpan}` : undefined,
      transition: 'all 0.2s ease',
      ...style,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px',
        background: '#F8FAFC', borderBottom: '1px solid #E2E8F0',
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A', letterSpacing: '-0.01em' }}>{title}</span>
        <span style={{ flex: 1 }} />
        {onRefresh && (
          <span style={{
            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4, color: '#64748B', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease'
          }}
          onClick={onRefresh}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#2563EB' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B' }}
          >↻</span>
        )}
        {onMaximize && (
          <span style={{
            width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderRadius: 4, color: '#64748B', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease'
          }}
          onClick={onMaximize}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#EFF6FF'; e.currentTarget.style.color = '#2563EB' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748B' }}
          >⤢</span>
        )}
        <span style={{
          width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 4, color: '#94A3B8', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s ease'
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#F1F5F9'; e.currentTarget.style.color = '#334155' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#94A3B8' }}
        >⋮</span>
      </div>
      <div style={{ padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  )
}
