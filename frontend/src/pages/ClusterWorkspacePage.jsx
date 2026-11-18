import React from 'react'
import { useLocation } from 'react-router-dom'
import ClusterNavHeader from '../components/cluster/ClusterNavHeader'
import NodeManagerPage from './NodeManagerPage'
import PackagesPage from './PackagesPage'
import JobsPage from './JobsPage'
import StoragePage from './StoragePage'
import UsersPage from './UsersPage'
import ServicesPage from './ServicesPage'
import AuditLogsPage from './AuditLogsPage'
import ClusterConfigurationPage from './ClusterConfigurationPage'

const SECTIONS = {
  '/cluster/config': {
    title: 'Cluster Configuration & Services',
    subtitle: 'Configure master controller, worker compute nodes, and 6-stage HPC service dependency pipeline.',
    component: <ClusterConfigurationPage />,
  },
  '/cluster/configuration': {
    title: 'Cluster Configuration & Services',
    subtitle: 'Configure master controller, worker compute nodes, and 6-stage HPC service dependency pipeline.',
    component: <ClusterConfigurationPage />,
  },
  '/cluster/nodes': {
    title: 'Node Management',
    subtitle: 'Register, test, monitor and administer master and worker compute nodes.',
    component: <NodeManagerPage />,
  },
  '/cluster/apps': {
    title: 'HPC Applications',
    subtitle: 'Manage scientific compilers, MPI fabrics, Spack environments, and Lmod modules.',
    component: <PackagesPage />,
  },
  '/cluster/jobs': {
    title: 'Job Scheduler',
    subtitle: 'Manage Slurm queues, running batch jobs, workload partitions, and resource allocations.',
    component: <JobsPage />,
  },
  '/cluster/storage': {
    title: 'Storage Management',
    subtitle: 'Manage NFS exports, client mount points, shared directories, and storage capacity.',
    component: <StoragePage />,
  },
  '/cluster/identity': {
    title: 'Identity & Access (FreeIPA)',
    subtitle: 'Configure centralized LDAP/Kerberos directory services and manage HPC user accounts.',
    component: <UsersPage />,
  },
  '/cluster/services': {
    title: 'Services & Health',
    subtitle: 'Monitor and control HPC cluster daemons (slurmctld, slurmd, munge, sssd, chronyd, nfs).',
    component: <ServicesPage />,
  },
  '/cluster/activity': {
    title: 'Cluster Activity & Logs',
    subtitle: 'Inspect immutable audit events, operator actions, and system logs across nodes.',
    component: <AuditLogsPage />,
  },
}

export default function ClusterWorkspacePage({ section }) {
  const location = useLocation()
  const currentPath = section || location.pathname

  const sec = SECTIONS[currentPath] || {
    title: 'Cluster Workspace',
    subtitle: 'Manage and monitor your high-performance computing cluster infrastructure.',
    component: <NodeManagerPage />,
  }

  return (
    <div>
      <ClusterNavHeader title={sec.title} subtitle={sec.subtitle} />
      <div>{sec.component}</div>
    </div>
  )
}
