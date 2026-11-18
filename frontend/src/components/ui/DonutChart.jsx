import React from 'react'
export default function DonutChart({ segments = [], centerNum = 0, centerLabel = '', size = 112 }) {
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1
  let cumulative = 0
  const gradientParts = segments.map((seg) => {
    const start = (cumulative / total) * 100
    cumulative += seg.value
    const end = (cumulative / total) * 100
    return `${seg.color} ${start}% ${end}%`
  })

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{
        position: 'relative', width: size, height: size, borderRadius: '50%', flex: 'none',
        background: `conic-gradient(${gradientParts.join(', ')})`,
      }}>
        <div style={{
          position: 'absolute', inset: 20, background: 'var(--card)',
          borderRadius: '50%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{centerNum}</span>
          <span style={{ fontSize: 9.5, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.03em' }}>{centerLabel}</span>
        </div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {segments.map((seg, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, flex: 'none', background: seg.color }} />
            <span>{seg.label}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700 }}>{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
