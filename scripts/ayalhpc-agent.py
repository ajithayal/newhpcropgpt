#!/usr/bin/env python3
"""
AYAL HPC — Production Monitoring & Fleet Telemetry Agent Daemon
==============================================================
Centralized real-time telemetry collector for Master and Worker nodes.
Collects hardware, OS, network, storage, GPU, HPC services, Slurm, and packages.
Requires only standard Python 3.6+ without external dependencies.
"""

import os
import sys
import time
import json
import socket
import argparse
import logging
import platform
import subprocess
import urllib.request
import urllib.error
from datetime import datetime, timezone

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [AYAL-Agent] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ayalhpc_agent")

AGENT_VERSION = "2.5.0-production"
DEFAULT_CONFIG_PATH = "/etc/ayalhpc/agent.json"
NODE_ID_FILE = "/etc/ayalhpc/node_id"
TOKEN_FILE = "/etc/ayalhpc/agent_token"


def run_cmd(cmd, timeout=5):
    """Run a shell command safely and return stdout, stderr, exit_code."""
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
        )
        return proc.stdout.strip(), proc.stderr.strip(), proc.returncode
    except subprocess.TimeoutExpired:
        return "", "Command timed out", 124
    except Exception as e:
        return "", str(e), 1


def read_file(path):
    """Safely read content from a file or return empty string."""
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read().strip()
    except Exception:
        pass
    return ""


class AyalHpcCollector:
    """Collects real-time hardware, operating system, and HPC telemetry."""

    @classmethod
    def get_hostname_and_ip(cls):
        hostname = socket.gethostname()
        fqdn = socket.getfqdn()
        primary_ip = ""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80))
            primary_ip = s.getsockname()[0]
            s.close()
        except Exception:
            try:
                primary_ip = socket.gethostbyname(hostname)
            except Exception:
                primary_ip = "127.0.0.1"
        return hostname, fqdn, primary_ip

    @classmethod
    def collect_hardware(cls):
        """Collect server model, CPU, RAM, disks, GPU."""
        # 1. System Manufacturer & Model
        vendor = read_file("/sys/class/dmi/id/sys_vendor") or "N/A"
        product = read_file("/sys/class/dmi/id/product_name") or "N/A"
        serial = read_file("/sys/class/dmi/id/product_serial") or "N/A"

        if vendor == "N/A":
            out, _, code = run_cmd("dmidecode -s system-manufacturer 2>/dev/null")
            if code == 0 and out:
                vendor = out
        if product == "N/A":
            out, _, code = run_cmd("dmidecode -s system-product-name 2>/dev/null")
            if code == 0 and out:
                product = out

        # 2. CPU info
        cpu_model = "Unknown"
        cpu_cores = os.cpu_count() or 1
        cpu_sockets = 1
        threads_per_core = 1
        cpu_info = read_file("/proc/cpuinfo")
        for line in cpu_info.splitlines():
            if line.startswith("model name") and cpu_model == "Unknown":
                parts = line.split(":", 1)
                if len(parts) > 1:
                    cpu_model = parts[1].strip()
                    break

        lscpu_out, _, code = run_cmd("lscpu 2>/dev/null")
        if code == 0 and lscpu_out:
            for line in lscpu_out.splitlines():
                if "Socket(s):" in line:
                    try: cpu_sockets = int(line.split(":")[1].strip())
                    except: pass
                elif "Thread(s) per core:" in line:
                    try: threads_per_core = int(line.split(":")[1].strip())
                    except: pass

        # CPU Temperature
        cpu_temp = None
        for i in range(5):
            t_path = f"/sys/class/thermal/thermal_zone{i}/temp"
            if os.path.exists(t_path):
                raw = read_file(t_path)
                if raw and raw.isdigit():
                    cpu_temp = round(float(raw) / 1000.0, 1)
                    break

        # 3. RAM info
        mem_info = read_file("/proc/meminfo")
        total_kb = 0
        avail_kb = 0
        free_kb = 0
        cached_kb = 0
        for line in mem_info.splitlines():
            parts = line.split(":")
            if len(parts) == 2:
                k = parts[0].strip()
                v_str = parts[1].strip().split()[0]
                if v_str.isdigit():
                    v = int(v_str)
                    if k == "MemTotal": total_kb = v
                    elif k == "MemAvailable": avail_kb = v
                    elif k == "MemFree": free_kb = v
                    elif k == "Cached": cached_kb = v

        total_mb = round(total_kb / 1024.0, 1)
        avail_mb = round((avail_kb or free_kb + cached_kb) / 1024.0, 1)
        used_mb = max(0.0, round(total_mb - avail_mb, 1))
        mem_util = round((used_mb / max(total_mb, 1.0)) * 100.0, 1)

        # 4. Storage & Disks
        disks = []
        lsblk_out, _, code = run_cmd("lsblk -b -J -o NAME,MODEL,SIZE,TYPE,MOUNTPOINT,ROTA,SERIAL 2>/dev/null")
        if code == 0 and lsblk_out:
            try:
                blk_data = json.loads(lsblk_out)
                for dev in blk_data.get("blockdevices", []):
                    size_gb = round(int(dev.get("size", 0)) / (1024**3), 1)
                    is_ssd = dev.get("rota") == False or dev.get("rota") == 0
                    disks.append({
                        "name": dev.get("name"),
                        "model": dev.get("model") or ("SSD" if is_ssd else "HDD"),
                        "size_gb": size_gb,
                        "type": dev.get("type"),
                        "mountpoint": dev.get("mountpoint"),
                        "is_ssd": is_ssd,
                        "serial": dev.get("serial") or "N/A",
                    })
            except Exception:
                pass

        # 5. GPU Telemetry
        gpus = []
        gpu_out, _, code = run_cmd(
            "nvidia-smi --query-gpu=index,name,driver_version,utilization.gpu,memory.total,memory.used,memory.free,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null"
        )
        if code == 0 and gpu_out:
            for line in gpu_out.splitlines():
                parts = [p.strip() for p in line.split(",")]
                if len(parts) >= 8:
                    try:
                        gpus.append({
                            "index": int(parts[0]),
                            "name": parts[1],
                            "driver_version": parts[2],
                            "utilization_pct": float(parts[3]),
                            "memory_total_mb": float(parts[4]),
                            "memory_used_mb": float(parts[5]),
                            "memory_free_mb": float(parts[6]),
                            "temperature_c": float(parts[7]),
                            "power_watts": float(parts[8]) if len(parts) > 8 and parts[8].replace(".", "", 1).isdigit() else None,
                        })
                    except Exception:
                        pass

        return {
            "vendor": vendor,
            "model": product,
            "serial_number": serial,
            "cpu": {
                "model": cpu_model,
                "cores": cpu_cores,
                "sockets": cpu_sockets,
                "threads_per_core": threads_per_core,
                "temperature_c": cpu_temp,
            },
            "memory": {
                "total_mb": total_mb,
                "used_mb": used_mb,
                "available_mb": avail_mb,
                "utilization_pct": mem_util,
            },
            "disks": disks,
            "gpus": gpus,
        }

    @classmethod
    def collect_os(cls):
        """Collect Linux OS, kernel, uptime, load averages, processes."""
        distro = "Linux"
        os_version = ""
        os_release = read_file("/etc/os-release")
        for line in os_release.splitlines():
            if line.startswith("PRETTY_NAME="):
                distro = line.split("=", 1)[1].strip('"\'')
            elif line.startswith("VERSION_ID="):
                os_version = line.split("=", 1)[1].strip('"\'')

        kernel = platform.release()
        arch = platform.machine()

        # Uptime
        uptime_sec = 0
        raw_uptime = read_file("/proc/uptime")
        if raw_uptime:
            try: uptime_sec = int(float(raw_uptime.split()[0]))
            except: pass

        # Load averages
        loadavg = [0.0, 0.0, 0.0]
        raw_load = read_file("/proc/loadavg")
        if raw_load:
            parts = raw_load.split()
            if len(parts) >= 3:
                try: loadavg = [float(parts[0]), float(parts[1]), float(parts[2])]
                except: pass

        # Running processes summary
        ps_out, _, code = run_cmd("ps -eo pid,user,comm,%cpu,%mem --sort=-%cpu 2>/dev/null | head -n 15")
        processes = []
        if code == 0 and ps_out:
            lines = ps_out.splitlines()[1:]
            for l in lines:
                parts = l.split(None, 4)
                if len(parts) >= 5:
                    processes.append({
                        "pid": parts[0],
                        "user": parts[1],
                        "command": parts[2],
                        "cpu_pct": parts[3],
                        "mem_pct": parts[4],
                    })

        # Process count
        proc_count = 0
        try:
            proc_count = len([d for d in os.listdir("/proc") if d.isdigit()])
        except Exception:
            pass

        return {
            "distribution": distro,
            "version": os_version,
            "kernel": kernel,
            "architecture": arch,
            "uptime_seconds": uptime_sec,
            "load_1m": loadavg[0],
            "load_5m": loadavg[1],
            "load_15m": loadavg[2],
            "process_count": proc_count,
            "top_processes": processes,
        }

    @classmethod
    def collect_network(cls):
        """Collect network interfaces, status, throughput, IP/MAC."""
        interfaces = []
        net_dev = read_file("/proc/net/dev")
        lines = net_dev.splitlines()[2:] if net_dev else []

        for line in lines:
            if ":" in line:
                iface, data = line.split(":", 1)
                iface = iface.strip()
                if iface == "lo": continue
                fields = data.split()
                if len(fields) >= 16:
                    rx_bytes = int(fields[0])
                    rx_errs = int(fields[2])
                    rx_drop = int(fields[3])
                    tx_bytes = int(fields[8])
                    tx_errs = int(fields[10])
                    tx_drop = int(fields[11])

                    # Status & MAC from sysfs
                    operstate = read_file(f"/sys/class/net/{iface}/operstate") or "unknown"
                    mac = read_file(f"/sys/class/net/{iface}/address") or "N/A"
                    speed = read_file(f"/sys/class/net/{iface}/speed")
                    speed_mbps = int(speed) if speed and speed.lstrip("-").isdigit() and int(speed) > 0 else None

                    interfaces.append({
                        "interface": iface,
                        "status": operstate,
                        "mac": mac,
                        "speed_mbps": speed_mbps,
                        "rx_bytes": rx_bytes,
                        "tx_bytes": tx_bytes,
                        "rx_errors": rx_errs,
                        "tx_errors": tx_errs,
                        "rx_drops": rx_drop,
                        "tx_drops": tx_drop,
                    })

        # DNS & Gateway
        dns_servers = []
        resolv = read_file("/etc/resolv.conf")
        for line in resolv.splitlines():
            if line.startswith("nameserver"):
                parts = line.split()
                if len(parts) > 1: dns_servers.append(parts[1])

        gateway = "N/A"
        gw_out, _, code = run_cmd("ip route show default 2>/dev/null")
        if code == 0 and gw_out:
            parts = gw_out.split()
            if len(parts) >= 3 and parts[0] == "default" and parts[1] == "via":
                gateway = parts[2]

        return {
            "interfaces": interfaces,
            "dns_servers": dns_servers,
            "gateway": gateway,
        }

    @classmethod
    def collect_storage(cls):
        """Collect filesystem mounts, usage, NFS client mounts."""
        mounts = []
        df_out, _, code = run_cmd("df -h -P -T 2>/dev/null")
        if code == 0 and df_out:
            lines = df_out.splitlines()[1:]
            for line in lines:
                parts = line.split()
                if len(parts) >= 7:
                    fs, fstype, size_s, used_s, avail_s, use_pct_s, mnt = parts[:7]
                    if fs.startswith("/dev/") or fstype in ["nfs", "nfs4", "xfs", "ext4", "btrfs", "zfs"]:
                        is_nfs = fstype in ["nfs", "nfs4"] or ":" in fs
                        mounts.append({
                            "filesystem": fs,
                            "fs_type": fstype,
                            "size": size_s,
                            "used": used_s,
                            "available": avail_s,
                            "use_pct": use_pct_s,
                            "mount_point": mnt,
                            "is_nfs": is_nfs,
                        })

        return {"mounts": mounts}

    @classmethod
    def collect_services(cls):
        """Collect status of core HPC systemd daemons."""
        services = [
            ("sshd", "OpenSSH Server"),
            ("sssd", "FreeIPA Identity Client (SSSD)"),
            ("chronyd", "Chrony NTP Synchronization"),
            ("munge", "Munge Authentication Daemon"),
            ("slurmctld", "Slurm Central Controller"),
            ("slurmd", "Slurm Node Daemon"),
            ("nfs-server", "NFS Server Daemon"),
            ("rpcbind", "RPC Bind Service"),
            ("node_exporter", "Node Exporter Telemetry"),
            ("prometheus", "Prometheus Metrics Server"),
            ("dcgm-exporter", "NVIDIA DCGM Exporter"),
            ("ayalhpc-agent", "AYAL HPC Management Agent"),
        ]
        results = []
        for unit, display_name in services:
            out_act, _, _ = run_cmd(f"systemctl is-active {unit} 2>/dev/null")
            out_en, _, _ = run_cmd(f"systemctl is-enabled {unit} 2>/dev/null")
            status = "running" if out_act == "active" else ("stopped" if out_act in ["inactive", "failed", "dead"] else "unconfigured")
            enabled = out_en if out_en in ["enabled", "disabled", "static"] else "unconfigured"
            
            # Version detection
            version = None
            if unit == "slurmd" or unit == "slurmctld":
                v_out, _, code = run_cmd("sinfo -V 2>/dev/null")
                if code == 0 and v_out:
                    version = v_out.replace("slurm", "").strip()
            elif unit == "munge":
                v_out, _, code = run_cmd("munged --version 2>/dev/null | head -n 1")
                if code == 0 and v_out:
                    version = v_out.split()[-1] if v_out.split() else None
            elif unit == "sshd":
                v_out, _, code = run_cmd("sshd -V 2>&1")
                if "OpenSSH" in v_out:
                    version = v_out.split()[0].replace("OpenSSH_", "")

            results.append({
                "service_name": unit,
                "display_name": display_name,
                "status": status,
                "enabled": enabled,
                "version": version or "N/A",
            })
        return results

    @classmethod
    def collect_slurm(cls):
        """Collect Slurm partitions, node states, and jobs."""
        sinfo_out, _, code = run_cmd("sinfo -o '%P %a %l %D %N' -h 2>/dev/null")
        partitions = []
        if code == 0 and sinfo_out:
            for line in sinfo_out.splitlines():
                parts = line.split()
                if len(parts) >= 5:
                    partitions.append({
                        "name": parts[0].replace("*", ""),
                        "state": parts[1],
                        "max_time": parts[2],
                        "nodes_count": int(parts[3]) if parts[3].isdigit() else 0,
                        "nodes": parts[4],
                    })

        squeue_out, _, code = run_cmd("squeue -o '%i|%u|%P|%j|%t|%M|%D|%R' -h 2>/dev/null")
        jobs = []
        if code == 0 and squeue_out:
            for line in squeue_out.splitlines():
                parts = line.split("|")
                if len(parts) >= 8:
                    jobs.append({
                        "job_id": parts[0],
                        "user": parts[1],
                        "partition": parts[2],
                        "name": parts[3],
                        "state": parts[4],
                        "time_used": parts[5],
                        "nodes": parts[6],
                        "reason": parts[7],
                    })

        return {
            "slurm_installed": len(partitions) > 0 or len(jobs) > 0,
            "partitions": partitions,
            "jobs": jobs,
            "running_count": sum(1 for j in jobs if j.get("state") in ["R", "RUNNING"]),
            "pending_count": sum(1 for j in jobs if j.get("state") in ["PD", "PENDING"]),
        }

    @classmethod
    def collect_packages(cls):
        """Collect sample installed packages (RPM/DNF, Lmod modules, Spack)."""
        packages = []
        # Sample top scientific/HPC packages or RPMs
        rpm_out, _, code = run_cmd(
            "rpm -qa --qf '%{NAME}|%{VERSION}-%{RELEASE}|%{VENDOR}\n' 2>/dev/null | grep -E 'slurm|munge|openmpi|mpich|cuda|gcc|cmake|spack|lmod|singularity|apptainer|kernel' | head -n 40"
        )
        if code == 0 and rpm_out:
            for line in rpm_out.splitlines():
                parts = line.split("|")
                if len(parts) >= 2:
                    packages.append({
                        "name": parts[0],
                        "version": parts[1],
                        "source": "rpm",
                        "package_manager": "dnf/rpm",
                        "vendor": parts[2] if len(parts) > 2 else "AlmaLinux/Rocky",
                    })

        # Lmod / Environment modules
        mod_out, _, code = run_cmd("module -t avail 2>&1")
        if code == 0 and mod_out:
            for line in mod_out.splitlines():
                l = line.strip()
                if l and not l.endswith(":") and "/" in l:
                    parts = l.split("/", 1)
                    packages.append({
                        "name": parts[0],
                        "version": parts[1],
                        "source": "lmod",
                        "package_manager": "module",
                        "vendor": "HPC Module",
                    })

        return packages


class AyalHpcAgent:
    """Manages collection loops and authenticated communication to AYAL HPC Backend."""

    def __init__(self, server_url, node_id=None, cluster_id=None, token=None, interval=5, role="compute"):
        self.server_url = server_url.rstrip("/")
        self.node_id = node_id or self._load_or_create_node_id()
        self.cluster_id = cluster_id
        self.token = token or self._load_token()
        self.interval = interval
        self.role = role
        self.running = True

        logger.info(f"Initialized AYAL Agent v{AGENT_VERSION}")
        logger.info(f"Target Server: {self.server_url}")
        logger.info(f"Node ID: {self.node_id} • Role: {self.role}")

    def _load_or_create_node_id(self):
        if os.path.exists(NODE_ID_FILE):
            val = read_file(NODE_ID_FILE).strip()
            if val: return val
        # Fallback to hostname
        host = socket.gethostname()
        try:
            os.makedirs(os.path.dirname(NODE_ID_FILE), exist_ok=True)
            with open(NODE_ID_FILE, "w") as f:
                f.write(host)
        except Exception:
            pass
        return host

    def _load_token(self):
        if os.path.exists(TOKEN_FILE):
            return read_file(TOKEN_FILE).strip()
        return "ayal-agent-default-token"

    def send_http(self, endpoint, data):
        """Send JSON payload to the central backend via HTTP POST."""
        url = f"{self.server_url}{endpoint}"
        body = json.dumps(data).encode("utf-8")
        headers = {
            "Content-Type": "application/json",
            "User-Agent": f"AYAL-Agent/{AGENT_VERSION}",
            "X-Node-ID": self.node_id,
            "Authorization": f"Bearer {self.token}",
        }
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=4.0) as resp:
                return resp.status, resp.read().decode("utf-8")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8")
        except Exception as e:
            return 0, str(e)

    def run_cycle(self):
        """Execute one full collection and transmit cycle."""
        hostname, fqdn, primary_ip = AyalHpcCollector.get_hostname_and_ip()
        hw = AyalHpcCollector.collect_hardware()
        os_info = AyalHpcCollector.collect_os()
        net = AyalHpcCollector.collect_network()
        storage = AyalHpcCollector.collect_storage()
        services = AyalHpcCollector.collect_services()
        slurm = AyalHpcCollector.collect_slurm()
        packages = AyalHpcCollector.collect_packages()

        payload = {
            "node_id": self.node_id,
            "cluster_id": self.cluster_id,
            "hostname": hostname,
            "fqdn": fqdn,
            "ip_address": primary_ip,
            "role": self.role,
            "agent_version": AGENT_VERSION,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "hardware": hw,
            "os": os_info,
            "network": net,
            "storage": storage,
            "services": services,
            "slurm": slurm,
            "packages": packages,
        }

        # Send full telemetry report
        status_code, resp_text = self.send_http("/api/agent/report", payload)
        if status_code in [200, 201]:
            logger.debug(f"Telemetry report sent successfully (code {status_code})")
        else:
            logger.warning(f"Failed to post telemetry to {self.server_url}/api/agent/report: [{status_code}] {resp_text}")

    def start(self):
        """Main agent loop."""
        logger.info(f"Starting telemetry collection loop (interval = {self.interval}s)...")
        while self.running:
            try:
                self.run_cycle()
            except Exception as e:
                logger.error(f"Error in collection cycle: {e}", exc_info=True)
            time.sleep(self.interval)


def main():
    parser = argparse.ArgumentParser(description="AYAL HPC Centralized Monitoring Agent")
    parser.add_argument("--server", default=os.getenv("AYAL_SERVER_URL", "http://localhost:8000"), help="Central backend URL")
    parser.add_argument("--node-id", default=os.getenv("AYAL_NODE_ID"), help="Unique node identifier")
    parser.add_argument("--cluster-id", default=os.getenv("AYAL_CLUSTER_ID"), help="Cluster UUID")
    parser.add_argument("--token", default=os.getenv("AYAL_AGENT_TOKEN"), help="Agent authentication token")
    parser.add_argument("--interval", type=int, default=int(os.getenv("AYAL_INTERVAL", "5")), help="Collection interval (seconds)")
    parser.add_argument("--role", default=os.getenv("AYAL_NODE_ROLE", "compute"), help="Node role: master, compute, gpu, storage")

    args = parser.parse_args()

    agent = AyalHpcAgent(
        server_url=args.server,
        node_id=args.node_id,
        cluster_id=args.cluster_id,
        token=args.token,
        interval=args.interval,
        role=args.role,
    )
    agent.start()


if __name__ == "__main__":
    main()
