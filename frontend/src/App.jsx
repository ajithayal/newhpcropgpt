import React, { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { App as AntApp, Spin, Result, Button } from 'antd'
import { WarningOutlined } from '@ant-design/icons'
import { useAuthStore } from './stores/authStore'
import SetupWizard from './pages/SetupWizard'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import MainLayout from './layouts/MainLayout'
import DashboardPage from './pages/DashboardPage'
import MonitoringPage from './pages/MonitoringPage'
import JobsPage from './pages/JobsPage'
import UsersPage from './pages/UsersPage'
import StoragePage from './pages/StoragePage'
import PackagesPage from './pages/PackagesPage'
import SettingsPage from './pages/SettingsPage'
import AlertsPage from './pages/AlertsPage'
import NetworkPage from './pages/NetworkPage'
import AuditLogsPage from './pages/AuditLogsPage'
import NodeManagerPage from './pages/NodeManagerPage'
import NodeDetailPage from './pages/NodeDetailPage'
import FileManagerPage from './pages/FileManagerPage'
import ServicesPage from './pages/ServicesPage'
import BackupPage from './pages/BackupPage'
import ClusterSetupWizard from './pages/ClusterSetupWizard'
import ClusterDashboardPage from './pages/ClusterDashboardPage'
import ClusterOverviewPage from './pages/ClusterOverviewPage'
import ClusterWorkspacePage from './pages/ClusterWorkspacePage'
import ClusterConfigurationPage from './pages/ClusterConfigurationPage'
import ClusterTerminalPage from './pages/ClusterTerminalPage'
import ClusterSlurmPage from './pages/ClusterSlurmPage'
import ClusterHealthPage from './pages/ClusterHealthPage'
import ClusterSecurityPage from './pages/ClusterSecurityPage'
import OperationsPage from './pages/OperationsPage'
import FreshConfigPage from './pages/FreshConfigPage'
import ClusterDecommissionPage from './pages/ClusterDecommissionPage'
import NodeRollbackPage from './pages/NodeRollbackPage'
import AgentsPage from './pages/AgentsPage'
import DatabaseAdminPage from './pages/DatabaseAdminPage'

function ProtectedRoute({ children }) {
  const { isAuthenticated, licenseValid } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" />
  if (licenseValid === false) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f0f2f5' }}>
        <Result status="warning" title="License Not Activated"
          subTitle="Your AYAL HPC license has expired or is not activated. Please contact support."
          icon={<WarningOutlined style={{ color: '#faad14' }} />}
          extra={[
            <Button type="primary" key="login" onClick={() => window.location.href = '/login'}>Sign In Again</Button>,
            <Button key="support" href="mailto:support@ayalhpc.local">Contact Support</Button>,
          ]} />
      </div>
    )
  }
  return children
}

export default function App() {
  const { isConfigured, checkSetup, loadBrand, checkLicense, isAuthenticated } = useAuthStore()
  useEffect(() => { checkSetup(); loadBrand() }, [])
  useEffect(() => { if (isAuthenticated) checkLicense() }, [isAuthenticated])

  if (isConfigured === null) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#1a1a2e' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
          <Spin size="large" />
          <span style={{ color: '#94A3B8', fontSize: 13, fontWeight: 500 }}>Loading AYAL HPC Platform...</span>
        </div>
      </div>
    )
  }

  return (
    <AntApp>
      <Routes>
      <Route path="/setup" element={<SetupWizard />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      {!isConfigured ? (
        <Route path="*" element={<SetupWizard />} />
      ) : (
        <>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <MainLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  <Route path="/monitoring/node" element={<NodeDetailPage />} />
                  <Route path="/monitoring/nodes/:nodeId" element={<NodeDetailPage />} />
                  <Route path="/nodes" element={<NodeManagerPage />} />
                  <Route path="/nodes/:nodeId" element={<NodeDetailPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/agents/:nodeId" element={<NodeDetailPage />} />
                  <Route path="/database" element={<DatabaseAdminPage />} />
                  <Route path="/settings/database" element={<DatabaseAdminPage />} />
                  <Route path="/cluster-setup" element={<ClusterSetupWizard />} />
                  <Route path="/cluster/create" element={<ClusterSetupWizard />} />
                  {/* Cluster section */}
                  <Route path="/cluster" element={<ClusterDashboardPage />} />
                  <Route path="/cluster/dashboard" element={<ClusterDashboardPage />} />
                  <Route path="/cluster/overview" element={<ClusterOverviewPage />} />
                  <Route path="/cluster/overview/:clusterId" element={<ClusterOverviewPage />} />
                  <Route path="/cluster/config" element={<ClusterConfigurationPage />} />
                  <Route path="/cluster/config/:clusterId" element={<ClusterConfigurationPage />} />
                  <Route path="/cluster/configuration" element={<ClusterConfigurationPage />} />
                  <Route path="/cluster/configuration/:clusterId" element={<ClusterConfigurationPage />} />
                  <Route path="/cluster/nodes" element={<NodeManagerPage />} />
                  <Route path="/cluster/nodes/:nodeId" element={<NodeDetailPage />} />
                  <Route path="/cluster/terminal" element={<ClusterTerminalPage />} />
                  <Route path="/cluster/terminal/:clusterId" element={<ClusterTerminalPage />} />
                  <Route path="/cluster/slurm" element={<ClusterSlurmPage />} />
                  <Route path="/cluster/slurm/:clusterId" element={<ClusterSlurmPage />} />
                  <Route path="/cluster/health" element={<ClusterHealthPage />} />
                  <Route path="/cluster/health/:clusterId" element={<ClusterHealthPage />} />
                  <Route path="/cluster/security" element={<ClusterSecurityPage />} />
                  <Route path="/cluster/security/:clusterId" element={<ClusterSecurityPage />} />
                  <Route path="/cluster/apps" element={<ClusterWorkspacePage section="/cluster/apps" />} />
                  <Route path="/cluster/jobs" element={<ClusterWorkspacePage section="/cluster/jobs" />} />
                  <Route path="/cluster/storage" element={<StoragePage />} />
                  <Route path="/cluster/identity" element={<ClusterWorkspacePage section="/cluster/identity" />} />
                  <Route path="/cluster/services" element={<ClusterWorkspacePage section="/cluster/services" />} />
                  <Route path="/cluster/activity" element={<ClusterWorkspacePage section="/cluster/activity" />} />
                  <Route path="/operations" element={<OperationsPage />} />
                  <Route path="/jobs" element={<JobsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/storage" element={<StoragePage />} />
                  <Route path="/files" element={<FileManagerPage />} />
                  <Route path="/packages" element={<PackagesPage />} />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route path="/network" element={<NetworkPage />} />
                  <Route path="/alerts" element={<AlertsPage />} />
                  <Route path="/audit" element={<AuditLogsPage />} />
                  <Route path="/cluster/decommission" element={<ClusterDecommissionPage />} />
                  <Route path="/cluster/decommission/:clusterId" element={<ClusterDecommissionPage />} />
                  <Route path="/cluster/nodes/:nodeId/rollback" element={<NodeRollbackPage />} />
                  <Route path="/nodes/rollback" element={<NodeRollbackPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/settings/fresh-config" element={<FreshConfigPage />} />
                  <Route path="/fresh-config" element={<FreshConfigPage />} />
                  <Route path="/backup" element={<BackupPage />} />
                  <Route path="*" element={<Navigate to="/" />} />
                </Routes>
              </MainLayout>
            </ProtectedRoute>
          } />
        </>
      )}
      </Routes>
    </AntApp>
  )
}
