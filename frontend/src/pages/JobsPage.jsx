import React from 'react'
import { useState, useEffect } from 'react'
import InfoCard from '../components/ui/InfoCard'
import { KVRow } from '../components/ui/Shared'
import api from '../services/api'
import { Modal, Form, Input, Select, message, Tabs, Empty } from 'antd'

export default function JobsPage() {
  const [jobs, setJobs] = useState([])
  const [partitions, setPartitions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showSubmit, setShowSubmit] = useState(false)
  const [form] = Form.useForm()

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const [jobsRes, partRes] = await Promise.all([
        api.get('/scheduler/jobs'),
        api.get('/scheduler/partitions'),
      ])
      setJobs(jobsRes.data?.jobs || jobsRes.data || [])
      setPartitions(partRes.data?.partitions || partRes.data || [])
    } catch (err) { console.error(err) }
    finally { setLoading(false) }
  }

  const submitJob = async (values) => {
    try {
      await api.post('/scheduler/jobs/submit', values)
      message.success('Job submitted')
      setShowSubmit(false)
      form.resetFields()
      loadData()
    } catch (err) { message.error('Failed to submit') }
  }

  const cancelJob = async (id) => {
    try { await api.post(`/scheduler/jobs/${id}/cancel`); message.success('Cancelled'); loadData() }
    catch { message.error('Failed') }
  }

  const getStatusColor = (s) => {
    const c = { running: 'var(--green)', completed: 'var(--blue)', pending: 'var(--orange)', failed: 'var(--red)', held: 'var(--purple)' }
    return c[s] || 'var(--gray)'
  }

  const tabItems = [
    {
      key: 'jobs', label: 'Jobs',
      children: (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Job Scheduler</span>
            <button onClick={() => setShowSubmit(true)} style={{
              padding: '5px 14px', borderRadius: 5, fontSize: 11.5, cursor: 'pointer',
              background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600,
            }}>+ Submit Job</button>
          </div>
          {jobs.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid var(--card-border)' }}>
              <Empty description="No active or pending Slurm jobs" />
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
            {jobs.map((job) => {
              const st = job.state || job.status || 'pending'
              const jid = job.slurm_job_id || job.job_id || job.id?.toString().slice(0, 8)
              return (
                <div key={job.id} style={{ border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{
                    padding: '8px 10px', background: 'var(--head-bg)', borderBottom: '1px solid var(--card-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{ fontWeight: 700, fontSize: 12 }}>Job #{jid}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 3,
                      background: getStatusColor(st) + '18',
                      color: getStatusColor(st), fontWeight: 600, textTransform: 'capitalize',
                    }}>{st}</span>
                  </div>
                  <div style={{ padding: 10 }}>
                    <KVRow label="Name" value={job.name || job.job_name || '-'} />
                    <KVRow label="Partition" value={job.partition || 'default'} />
                    <KVRow label="Nodes" value={job.nodes || 1} />
                    <KVRow label="CPUs" value={job.tasks || job.cpus || 1} />
                    <KVRow label="Time" value={job.walltime || job.time || '-'} />
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <button onClick={() => cancelJob(job.id)} style={{
                        flex: 1, padding: 4, fontSize: 10, border: '1px solid var(--red)',
                        borderRadius: 4, background: '#fff', color: 'var(--red)', cursor: 'pointer',
                      }}>Cancel</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )}
        </>
      ),
    },
    {
      key: 'partitions', label: 'Partitions',
      children: (
        partitions.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', background: '#fff', borderRadius: 8, border: '1px solid var(--card-border)' }}>
            <Empty description="No Slurm partitions configured. Partitions will appear once compute nodes are enrolled." />
          </div>
        ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {partitions.map((p) => (
            <div key={p.id || p.name} style={{ border: '1px solid var(--card-border)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ padding: '8px 10px', background: 'var(--head-bg)', borderBottom: '1px solid var(--card-border)' }}>
                <span style={{ fontWeight: 700, fontSize: 12 }}>{p.name}</span>
              </div>
              <div style={{ padding: 10 }}>
                <KVRow label="Max CPUs" value={p.max_cpus || '-'} />
                <KVRow label="Max Nodes" value={p.max_nodes || '-'} />
                <KVRow label="Max Time" value={p.max_time || '-'} />
                <KVRow label="State" value={p.state || 'up'} valueColor="var(--green)" />
              </div>
            </div>
          ))}
        </div>
        )
      ),
    },
  ]

  return (
    <>
      <Tabs items={tabItems} />
      <Modal title="Submit Job" open={showSubmit} onCancel={() => setShowSubmit(false)} onOk={() => form.submit()} okText="Submit">
        <Form form={form} layout="vertical" onFinish={submitJob}>
          <Form.Item name="name" label="Job Name" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="script" label="Script Path" rules={[{ required: true }]}><Input placeholder="/home/user/script.sh" /></Form.Item>
          <Form.Item name="partition" label="Partition">
            <Select placeholder="Select partition">
              {partitions.map(p => <Select.Option key={p.name} value={p.name}>{p.name}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="nodes" label="Nodes"><Input type="number" placeholder="1" /></Form.Item>
          <Form.Item name="cpus" label="CPUs"><Input type="number" placeholder="1" /></Form.Item>
          <Form.Item name="walltime" label="Wall Time"><Input placeholder="01:00:00" /></Form.Item>
          <Form.Item name="memory" label="Memory"><Input placeholder="4G" /></Form.Item>
        </Form>
      </Modal>
    </>
  )
}
