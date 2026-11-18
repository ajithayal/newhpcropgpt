import axios from 'axios'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export const authAPI = {
  getSetupStatus: () => api.get('/setup/status'),
  getSystemInfo: () => api.get('/setup/system-info'),
  getSmtpStatus: () => api.get('/setup/smtp/status'),
  testAndSaveSmtp: (data) => api.post('/setup/smtp/test-and-save', data),
  registerCustomer: (data) => api.post('/setup/register', data),
  confirmEmail: (data) => api.post('/setup/confirm-email', data),
  activateLicenseWizard: (data) => api.post('/setup/activate-license', data),
  finalizeAdmin: (data) => api.post('/setup/finalize-admin', data),
  resendOtp: (data) => api.post('/setup/resend-otp', data),
  runInstallTask: (data) => api.post('/setup/install-task', data),
  finalizeSystem: (data) => api.post('/setup/finalize-system', data),
  getCustomerProfile: () => api.get('/customer/profile'),
  completeSetup: (data) => api.post('/setup/complete', data),
  login: (data) => api.post('/auth/login', data),
  forgotPasswordRequest: (data) => api.post('/auth/forgot-password/request', data),
  forgotPasswordVerifyOtp: (data) => api.post('/auth/forgot-password/verify-otp', data),
  forgotPasswordReset: (data) => api.post('/auth/forgot-password/reset', data),
}

export const usersAPI = {
  list: (params) => api.get('/users', { params }),
  get: (id) => api.get(`/users/${id}`),
  getMe: () => api.get('/users/me'),
  create: (data) => api.post('/users', data),
  update: (id, data) => api.put(`/users/${id}`, data),
  delete: (id) => api.delete(`/users/${id}`),
}

export const adminAPI = {
  getBranding: () => api.get('/settings/branding'),
  updateBranding: (data) => api.put('/settings/branding', data),
  getClusterConfig: () => api.get('/settings/cluster'),
  updateClusterConfig: (data) => api.put('/settings/cluster', data),
  getFreeIPAConfig: () => api.get('/settings/freeipa'),
  updateFreeIPAConfig: (data) => api.put('/settings/freeipa', data),
  testFreeIPA: (data) => api.post('/settings/freeipa/test', data),
  getAuditLogs: (params) => api.get('/audit-logs', { params }),
  getNotifications: () => api.get('/notifications'),
  getStats: () => api.get('/stats/overview'),
  getAlerts: (params) => api.get('/alerts', { params }),
  acknowledgeAlert: (id) => api.put(`/alerts/${id}/acknowledge`),
  resolveAlert: (id) => api.put(`/alerts/${id}/resolve`),
  getServices: () => api.get('/services'),
  getTenants: () => api.get('/tenants'),
}

export const licenseAPI = {
  verifyOtp: (data) => api.post('/license/verify-otp', data),
  requestActivationKey: (data) => api.post('/license/request-activation-key', data),
  activate: (data) => api.post('/license/activate', data),
  getStatus: () => api.get('/license/status'),
  list: (params) => api.get('/license', { params }),
  issue: (data) => api.post('/license/issue', data),
  revoke: (customerId) => api.post('/license/revoke', null, { params: { customer_id: customerId } }),
}

export const monitoringAPI = {
  getNodes: (params) => api.get('/monitoring/nodes', { params }),
  getStats: () => api.get('/monitoring/stats'),
}

export const nodesAPI = {
  list: (params) => api.get('/nodes', { params }),
  get: (id) => api.get(`/nodes/${id}`),
  create: (data) => api.post('/nodes', data),
  update: (id, data) => api.put(`/nodes/${id}`, data),
  delete: (id) => api.delete(`/nodes/${id}`),
  drain: (id) => api.post(`/nodes/${id}/drain`),
  maintenance: (id) => api.post(`/nodes/${id}/maintenance`),
  resume: (id) => api.post(`/nodes/${id}/resume`),
  testConnection: (id) => api.post(`/nodes/${id}/test-connection`),
  collectHardware: (id) => api.post(`/nodes/${id}/collect-hardware`),
  refreshMetrics: (id) => api.post(`/nodes/${id}/refresh-metrics`),
  probe: (id) => api.post(`/nodes/${id}/probe`),
  getTelemetry: (id) => api.get(`/nodes/${id}/telemetry`),
  testStandaloneConnection: (data) => api.post('/nodes/test-connection', data),
  getStats: () => api.get('/nodes/stats'),
}

export const jobsAPI = {
  list: (params) => api.get('/scheduler/jobs', { params }),
  get: (id) => api.get(`/scheduler/jobs/${id}`),
  submit: (data) => api.post('/scheduler/jobs/submit', data),
  cancel: (id) => api.post(`/scheduler/jobs/${id}/cancel`),
  hold: (id) => api.post(`/scheduler/jobs/${id}/hold`),
  release: (id) => api.post(`/scheduler/jobs/${id}/release`),
  requeue: (id) => api.post(`/scheduler/jobs/${id}/requeue`),
  getStats: () => api.get('/scheduler/stats'),
}

export const partitionsAPI = {
  list: () => api.get('/scheduler/partitions'),
  create: (data) => api.post('/scheduler/partitions', data),
  update: (id, data) => api.put(`/scheduler/partitions/${id}`, data),
  delete: (id) => api.delete(`/scheduler/partitions/${id}`),
}

export const storageAPI = {
  list: () => api.get('/storage'),
  getOverview: () => api.get('/storage/overview'),
  getVolumes: () => api.get('/storage/volumes'),
  getClients: () => api.get('/storage/clients'),
  getSettings: () => api.get('/storage/settings'),
  testNfsConnection: (data) => api.post('/storage/nfs/test-connection', data),
  discoverNfsStorage: (data) => api.post('/storage/nfs/discover', data),
  configureNfsExports: (data) => api.post('/storage/nfs/configure-exports', data),
  configureNfsClients: (data) => api.post('/storage/nfs/configure-clients', data),
  listNfsExports: (serverIp) => api.get('/storage/nfs/exports', { params: { server_ip: serverIp } }),
  deleteNfsExport: (path, serverIp) => api.delete('/storage/nfs/exports', { params: { path, server_ip: serverIp } }),
  batchDeleteNfsExports: (data) => api.post('/storage/nfs/exports/batch-delete', data),
  create: (data) => api.post('/storage', data),
}

export const packagesAPI = {
  list: (params) => api.get('/packages', { params }),
  install: (id) => api.post(`/packages/${id}/install`),
}

export const ticketsAPI = {
  list: () => api.get('/tickets'),
  create: (data) => api.post('/tickets', data),
}

export const filesAPI = {
  browse: (params) => api.get('/files/browse', { params }),
  mkdir: (data) => api.post('/files/mkdir', data),
  rename: (data) => api.post('/files/rename', data),
  delete: (data) => api.post('/files/delete', data),
  copyMove: (data) => api.post('/files/copy-move', data),
  preview: (params) => api.get('/files/preview', { params }),
  setPermissions: (data) => api.post('/files/permissions', data),
  getShares: () => api.get('/files/shares'),
  share: (data) => api.post('/files/share', data),
  revokeShare: (id) => api.delete(`/files/share/${id}`),
  upload: (nodeIp, targetDir, file) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('target_dir', targetDir)
    fd.append('node_ip', nodeIp)
    return api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
}

export const servicesAPI = {
  list: () => api.get('/services'),
  start: (id) => api.post(`/services/${id}/start`),
  stop: (id) => api.post(`/services/${id}/stop`),
  restart: (id) => api.post(`/services/${id}/restart`),
}

export const clusterAPI = {
  getClusters: () => api.get('/clusters'),
  getOverview: () => api.get('/cluster-mgmt/clusters/overview'),
  update: (id, data) => api.put(`/cluster-mgmt/clusters/${id}`, data),
  delete: (id) => api.delete(`/cluster-mgmt/clusters/${id}`),
}

export const clusterMgmtAPI = {
  getOverview: () => api.get('/cluster-mgmt/clusters/overview'),
  updateCluster: (id, data) => api.put(`/cluster-mgmt/clusters/${id}`, data),
  deleteCluster: (id) => api.delete(`/cluster-mgmt/clusters/${id}`),
  getClusterConfig: (clusterId) => api.get(`/cluster-mgmt/clusters/${clusterId}/config`),
  validateService: (clusterId, service, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/config/${service}/validate`, data),
  applyService: (clusterId, service, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/config/${service}/apply`, data),
  saveDraftService: (clusterId, service, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/config/${service}/draft`, data),
  testEmail: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/config/monitoring/test-email`, data),
  executeTerminal: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/terminal/execute`, data),
  deployHpcStage: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/hpc-deploy/stage`, data),
  getHpcDeployStatus: (clusterId) => api.get(`/cluster-mgmt/clusters/${clusterId}/hpc-deploy/status`),
  resetHpcDeploy: (clusterId) => api.post(`/cluster-mgmt/clusters/${clusterId}/hpc-deploy/reset`),
  detectSlurmTopology: (clusterId) => api.post(`/cluster-mgmt/clusters/${clusterId}/slurm/detect-topology`),
  applySlurmConfig: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/slurm/apply-config`, data),
  runSlurmTest: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/slurm/run-test`, data),
  deleteCustomSlurmConf: (clusterId) => api.delete(`/cluster-mgmt/clusters/${clusterId}/slurm/custom-config`),
  validateSlurmConf: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/slurm/validate-config`, data),
  generateSlurmConf: (clusterId, data) => api.post(`/cluster-mgmt/clusters/${clusterId}/slurm/generate-config`, data),
  getHealthAudit: (clusterId) => api.get(`/cluster-mgmt/clusters/${clusterId}/health-audit`),
  fixHealthLayer: (clusterId, layerId) => api.post(`/cluster-mgmt/clusters/${clusterId}/health-fix/${layerId}`),
}

export const nodeOperationsAPI = {
  getClusterNodes: (clusterId = 'default') => api.get(`/clusters/${clusterId}/nodes`),
  getClusterEvents: (clusterId = 'default', limit = 50) => api.get(`/clusters/${clusterId}/events`, { params: { limit } }),
  testNodeConnection: (clusterId, nodeId, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/test-connection`, data),
  installAgent: (clusterId, nodeId, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/install-agent`, data),
  uninstallAgent: (clusterId, nodeId, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/uninstall-agent`, data),
  reinstallAgent: (clusterId, nodeId, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/reinstall-agent`, data),
  remediateNode: (clusterId, nodeId, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/remediate`, data),
  getPackages: (clusterId, nodeId, q) => api.get(`/clusters/${clusterId}/nodes/${nodeId}/packages`, { params: { q } }),
  installPackage: (clusterId, nodeId, data) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/packages/install`, data),
  uninstallPackage: (clusterId, nodeId, data) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/packages/uninstall`, data),
  getServices: (clusterId, nodeId) => api.get(`/clusters/${clusterId}/nodes/${nodeId}/services`),
  controlService: (clusterId, nodeId, serviceName, action, data = {}) => api.post(`/clusters/${clusterId}/nodes/${nodeId}/services/${serviceName}/${action}`, data),
  getServiceLogs: (clusterId, nodeId, serviceName, lines = 50) => api.get(`/clusters/${clusterId}/nodes/${nodeId}/services/${serviceName}/logs`, { params: { lines } }),
  getOperations: (clusterId, nodeId) => api.get(`/clusters/${clusterId}/nodes/${nodeId}/operations`),
}

export const clusterSetupAPI = {
  getDraft: () => api.get('/cluster-setup/draft'),
  saveDraft: (data) => api.post('/cluster-setup/draft', data),
  getPreflightReport: (data) => api.post('/cluster-setup/preflight-report', data),
  validateNodeDetails: (data) => api.post('/cluster-setup/validate-node-details', data),
  testSSH: (data) => api.post('/cluster-setup/test-ssh', data),
  testMasterConnection: (data) => api.post('/cluster-setup/test-master-connection', data),
  testWorkerConnection: (data) => api.post('/cluster-setup/test-worker-connection', data),
  getNodeServices: (data) => api.post('/cluster-setup/node-services', data),
  installAgents: (data) => api.post('/cluster-setup/install-agents', data),
  discoverHardware: (data) => api.post('/cluster-setup/discover-hardware', data),
  remediateNode: (data) => api.post('/cluster-setup/remediate-node', data),
  enrollFreeIPA: (data) => api.post('/cluster-setup/enroll-freeipa', data),
  installPackages: (data) => api.post('/cluster-setup/install-packages', data),
  validateServices: (data) => api.post('/cluster-setup/validate-services', data),
  commitNodes: (data) => api.post('/cluster-setup/commit-nodes', data),
  // Legacy aliases
  validateMaster: (data) => api.post('/cluster-setup/validate-master', data),
  validateWorkers: (data) => api.post('/cluster-setup/validate-workers', data),
  finalize: (data) => api.post('/cluster-setup/finalize', data),
}

export const agentsAPI = {
  list: (params) => api.get('/agents', { params }),
  get: (nodeId) => api.get(`/agents/${nodeId}`),
  getStatus: (nodeId) => api.get(`/agents/${nodeId}/status`),
  getInventory: (nodeId) => api.get(`/agents/${nodeId}/inventory`),
  getMetrics: (nodeId, limit = 50) => api.get(`/agents/${nodeId}/metrics`, { params: { limit } }),
  getLogs: (nodeId, lines = 100) => api.get(`/agents/${nodeId}/logs`, { params: { lines } }),
  collect: (nodeId) => api.post(`/agents/${nodeId}/collect`),
  install: (nodeId, data = {}) => api.post(`/agents/${nodeId}/install`, data),
  reinstall: (nodeId, data = {}) => api.post(`/agents/${nodeId}/reinstall`, data),
  restart: (nodeId) => api.post(`/agents/${nodeId}/restart`),
  stop: (nodeId) => api.post(`/agents/${nodeId}/stop`),
  start: (nodeId) => api.post(`/agents/${nodeId}/start`),
  unregister: (nodeId) => api.post(`/agents/${nodeId}/unregister`),
}

export const databaseAPI = {
  getInfo: () => api.get('/database/info'),
  getTables: () => api.get('/database/tables'),
  getHealth: () => api.get('/database/health'),
  testConnection: (data) => api.post('/database/test', data),
  connect: (data) => api.post('/database/connect', data),
  disconnect: () => api.post('/database/disconnect'),
}

export const identityAPI = {
  getFreeIPAConfig: () => api.get('/identity/freeipa/config'),
  updateFreeIPAConfig: (data) => api.put('/identity/freeipa/config', data),
  testFreeIPA: (data) => api.post('/identity/freeipa/test', data),
  getEnrolledNodes: () => api.get('/identity/freeipa/nodes'),
  enrollClient: (data) => api.post('/identity/freeipa/enroll', data),
  discoverStorage: (nodeIp) => api.get('/identity/storage/discover', { params: { node_ip: nodeIp } }),
  validatePath: (data) => api.post('/identity/storage/validate-path', data),
  provisionUser: (data) => api.post('/identity/users/provision', data),
  updateProvisionedUser: (userId, data) => api.put(`/identity/users/provision/${userId}`, data),
  getQuotas: () => api.get('/identity/quotas'),
  updateQuota: (userId, data) => api.put(`/identity/quotas/${userId}`, data),
  verifyRepairQuota: (userId) => api.post(`/identity/users/${userId}/verify-repair-quota`),
  getGroups: () => api.get('/identity/groups'),
  createGroup: (data) => api.post('/identity/groups', data),
}

export const backupAPI = {
  list: () => api.get('/backups'),
  create: () => api.post('/backups/create'),
  restore: (data) => api.post('/backups/restore', data),
  delete: (filename) => api.delete(`/backups/${filename}`),
  download: (filename) => api.get(`/backups/${filename}/download`, { responseType: 'blob' }),
  getRepositories: () => api.get('/backups/repositories'),
  createRepository: (data) => api.post('/backups/repositories', data),
  getJobs: () => api.get('/backups/jobs'),
  createJob: (data) => api.post('/backups/jobs', data),
  updateJob: (jobId, data) => api.put(`/backups/jobs/${jobId}`, data),
  deleteJob: (jobId) => api.delete(`/backups/jobs/${jobId}`),
  pauseJob: (jobId) => api.post(`/backups/jobs/${jobId}/pause`),
  runJob: (jobId) => api.post(`/backups/jobs/${jobId}/run`),
  getHistory: () => api.get('/backups/history'),
}

export const powerAPI = {
  getDashboard: () => api.get('/power/dashboard'),
  getPsus: () => api.get('/power/psu'),
  getServersPsuSummary: () => api.get('/power/servers/psu-summary'),
  getServerPsus: (serverId) => api.get(`/power/servers/${serverId}/psus`),
  getServerPowerSummary: (serverId) => api.get(`/power/servers/${serverId}/power-summary`),
  refreshPsus: () => api.post('/power/psu/refresh'),
  getUpsDevices: () => api.get('/power/ups'),
  saveUpsDevice: (data) => api.post('/power/ups', data),
  deleteUpsDevice: (id) => api.delete(`/power/ups/${id}`),
  testSnmp: (data) => api.post('/power/ups/test-snmp', data),
  getBmcDevices: () => api.get('/power/bmc'),
  saveBmcDevice: (data) => api.post('/power/bmc', data),
  testBmc: (id) => api.post(`/power/bmc/${id}/test`),
  executeBmcAction: (id, action) => api.post(`/power/bmc/${id}/action`, { action }),
  getAlertRules: () => api.get('/power/alerts/rules'),
  updateAlertRule: (id, data) => api.put(`/power/alerts/rules/${id}`, data),
  getShutdownPolicies: () => api.get('/power/shutdown/policies'),
  saveShutdownPolicy: (data) => api.post('/power/shutdown/policies', data),
  dryRunShutdown: (id) => api.post(`/power/shutdown/policies/${id}/dry-run`),
  executeShutdown: (id) => api.post(`/power/shutdown/policies/${id}/execute`),
  getEvents: (params) => api.get('/power/events', { params }),
  exportEventsUrl: () => '/api/power/events/export',
}

export const bmcAPI = {
  getServers: (controllerType) => api.get('/bmc/servers', { params: { controller_type: controllerType } }),
  validateAndDiscover: (data) => api.post('/bmc/validate-and-discover', data),
  saveServer: (data) => api.post('/bmc/servers', data),
  deleteServer: (id) => api.delete(`/bmc/servers/${id}`),
  getServerInventory: (id) => api.get(`/bmc/servers/${id}/inventory`),
  refreshServerInventory: (id) => api.post(`/bmc/servers/${id}/refresh-inventory`),
  getAllInventories: () => api.get('/bmc/inventory'),
  getHistory: (limit) => api.get('/bmc/history', { params: { limit } }),
}


export const rolesAPI = {
  list: () => api.get('/roles'),
}

export const freshConfigAPI = {
  audit: () => api.get('/system/fresh-config/audit'),
  preview: (data) => api.post('/system/fresh-config/preview', data),
  execute: (data) => api.post('/system/fresh-config/execute', data),
  getReports: (limit) => api.get('/system/fresh-config/reports', { params: { limit } }),
}

export const clusterDecommissionAPI = {
  discover: (clusterId) => api.get(`/cluster-mgmt/decommission/discover/${clusterId}`),
  preview: (data) => api.post('/cluster-mgmt/decommission/preview', data),
  execute: (data) => api.post('/cluster-mgmt/decommission/execute', data),
  verify: (jobId) => api.get(`/cluster-mgmt/decommission/verify/${jobId}`),
}

export const nodeRollbackAPI = {
  getSnapshots: (nodeId) => api.get(`/node-mgmt/rollback/snapshots/${nodeId}`),
  createSnapshot: (nodeId, label) => api.post('/node-mgmt/rollback/create-snapshot', null, { params: { node_id: nodeId, label } }),
  diff: (data) => api.post('/node-mgmt/rollback/diff', data),
  execute: (data) => api.post('/node-mgmt/rollback/execute', data),
  getHistory: (nodeId) => api.get('/node-mgmt/rollback/history', { params: { node_id: nodeId } }),
}

export const applicationManagementAPI = {
  getInventory: (clusterId, nodeId) => api.get('/packages-mgmt/inventory', { params: { cluster_id: clusterId, node_id: nodeId } }),
  getCatalog: (category) => api.get('/packages-mgmt/available', { params: { category } }),
  getDependencies: (packageName, targetNode) => api.post('/packages-mgmt/dependencies', { package_name: packageName, target_node: targetNode }),
  install: (data) => api.post('/packages-mgmt/install', data),
  uninstall: (data) => api.post('/packages-mgmt/uninstall', data),
  getOperations: (clusterId, limit) => api.get('/packages-mgmt/operations', { params: { cluster_id: clusterId, limit } }),
  rollbackOperation: (opId) => api.post(`/packages-mgmt/rollback/${opId}`),
}

export default api
