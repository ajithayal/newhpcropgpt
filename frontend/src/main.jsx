import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConfigProvider
        theme={{
          token: {
            colorPrimary: '#2563EB',
            colorLink: '#2563EB',
            colorSuccess: '#16A34A',
            colorWarning: '#EAB308',
            colorError: '#DC2626',
            colorInfo: '#3B82F6',
            colorBgBase: '#FFFFFF',
            colorTextBase: '#0F172A',
            borderRadius: 8,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          },
          components: {
            Card: {
              headerBg: '#FAFAFA',
              headerFontSize: 13,
            },
            Table: {
              headerBg: '#F8FAFC',
              headerColor: '#475569',
              rowHoverBg: '#F1F5F9',
            },
            Button: {
              borderRadius: 6,
              fontWeight: 500,
            },
            Tabs: {
              itemActiveColor: '#2563EB',
              itemSelectedColor: '#2563EB',
              inkBarColor: '#2563EB',
            },
          },
        }}
      >
        <App />
      </ConfigProvider>
    </BrowserRouter>
  </React.StrictMode>
)
