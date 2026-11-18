"""
Prometheus monitoring integration.
Queries Prometheus for HPC cluster metrics.
"""
import httpx
from typing import Optional
from datetime import datetime, timedelta


class PrometheusService:
    def __init__(self, prometheus_url: str = "http://prometheus:9090"):
        self.base_url = prometheus_url.rstrip("/")

    async def query(self, query: str) -> Optional[dict]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/v1/query", params={"query": query})
                resp.raise_for_status()
                return resp.json()
            except Exception:
                return None

    async def query_range(self, query: str, start: str, end: str, step: str = "60s") -> Optional[dict]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.get(f"{self.base_url}/api/v1/query_range", params={
                    "query": query, "start": start, "end": end, "step": step,
                })
                resp.raise_for_status()
                return resp.json()
            except Exception:
                return None

    async def get_cluster_overview(self) -> dict:
        cpu_query = '100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'
        mem_query = '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100'

        cpu_result = await self.query(cpu_query)
        mem_result = await self.query(mem_query)

        return {
            "cpu_usage": round(float(cpu_result["data"]["result"][0]["value"][1]), 1) if cpu_result and cpu_result["data"]["result"] else None,
            "memory_usage": round(float(mem_result["data"]["result"][0]["value"][1]), 1) if mem_result and mem_result["data"]["result"] else None,
        }

    async def get_node_metrics(self, hostname: str) -> dict:
        queries = {
            "cpu": f'100 - (avg(rate(node_cpu_seconds_total{{instance="{hostname}:9100",mode="idle"}}[5m])) * 100)',
            "memory": f'(1 - (node_memory_MemAvailable_bytes{{instance="{hostname}:9100"}} / node_memory_MemTotal_bytes{{instance="{hostname}:9100"}})) * 100',
            "disk": f'100 - ((node_filesystem_avail_bytes{{instance="{hostname}:9100",mountpoint="/"}} / node_filesystem_size_bytes{{instance="{hostname}:9100",mountpoint="/"}}) * 100)',
            "load1": f'node_load1{{instance="{hostname}:9100"}}',
        }

        results = {}
        for key, query in queries.items():
            result = await self.query(query)
            if result and result["data"]["result"]:
                results[key] = round(float(result["data"]["result"][0]["value"][1]), 1)
            else:
                results[key] = None
        return results

    async def get_gpu_metrics(self, hostname: str) -> dict:
        queries = {
            "gpu_utilization": f'DCGM_FI_DEV_GPU_UTIL{{instance="{hostname}:9400",gpu="0"}}',
            "gpu_memory": f'DCGM_FI_DEV_FB_USED{{instance="{hostname}:9400",gpu="0"}} / DCGM_FI_DEV_FB_FREE{{instance="{hostname}:9400",gpu="0"}} * 100',
            "gpu_temp": f'DCGM_FI_DEV_GPU_TEMP{{instance="{hostname}:9400",gpu="0"}}',
            "gpu_power": f'DCGM_FI_DEV_POWER_USAGE{{instance="{hostname}:9400",gpu="0"}}',
        }

        results = {}
        for key, query in queries.items():
            result = await self.query(query)
            if result and result["data"]["result"]:
                results[key] = round(float(result["data"]["result"][0]["value"][1]), 1)
            else:
                results[key] = None
        return results

    async def get_network_metrics(self, hostname: str) -> dict:
        queries = {
            "rx_rate": f'rate(node_network_receive_bytes_total{{instance="{hostname}:9100",device!="lo"}}[5m])',
            "tx_rate": f'rate(node_network_transmit_bytes_total{{instance="{hostname}:9100",device!="lo"}}[5m])',
            "rx_errors": f'sum(node_network_receive_errs_total{{instance="{hostname}:9100"}})',
            "tx_errors": f'sum(node_network_transmit_errs_total{{instance="{hostname}:9100"}})',
        }

        results = {}
        for key, query in queries.items():
            result = await self.query(query)
            if result and result["data"]["result"]:
                val = float(result["data"]["result"][0]["value"][1])
                if "rate" in key:
                    results[key] = round(val / 1024 / 1024, 2)
                else:
                    results[key] = round(val, 0)
            else:
                results[key] = 0
        return results

    async def get_slurm_metrics(self) -> dict:
        queries = {
            "running_jobs": 'slurm_jobs{state="RUNNING"}',
            "pending_jobs": 'slurm_jobs{state="PENDING"}',
            "total_nodes": 'slurm_nodes',
            "idle_nodes": 'slurm_nodes{state="idle"}',
        }

        results = {}
        for key, query in queries.items():
            result = await self.query(query)
            if result and result["data"]["result"]:
                results[key] = int(float(result["data"]["result"][0]["value"][1]))
            else:
                results[key] = 0
        return results


prometheus_service = PrometheusService()
