import React from 'react'
export default function Gauge({ value = 0, label = '', size = 74, color = 'var(--blue)' }) {
  const pct = Math.min(100, Math.max(0, value))
  const holeInset = 8
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2} cy={size / 2} r={size / 2 - 2}
            fill="none" stroke="#EEF1F5" strokeWidth="6"
          />
          <circle
            cx={size / 2} cy={size / 2} r={size / 2 - 2}
            fill="none" stroke={color} strokeWidth="6"
            strokeDasharray={`${(pct / 100) * 2 * Math.PI * (size / 2 - 2)} ${2 * Math.PI * (size / 2 - 2)}`}
            strokeDashoffset={2 * Math.PI * (size / 2 - 2) * 0.25}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: holeInset, background: 'var(--card)',
          borderRadius: '50%', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexDirection: 'column',
        }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>{pct}%</span>
        </div>
      </div>
      <div style={{ textAlign: 'center', fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>{label}</div>
    </div>
  )
}
