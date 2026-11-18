# AYAL HPC — High Performance Computing Management Platform

[![Release](https://img.shields.io/badge/Release-v1.0.0--Enterprise-blue.svg)](#)
[![License](https://img.shields.io/badge/License-Proprietary-red.svg)](#)
[![Platform](https://img.shields.io/badge/Platform-RHEL%20%7C%20Rocky%20%7C%20AlmaLinux%20%7C%20Ubuntu-green.svg)](#)

AYAL HPC is a centralized, high-performance computing (HPC) cluster management and telemetry orchestration platform. It provides enterprise infrastructure monitoring, job scheduling, storage volume management, FreeIPA identity lifecycle management, server BMC/iDRAC/iLO out-of-band administration, and PSU/UPS power management.

---

## System Requirements

### Supported Operating Systems
- **Rocky Linux 8 / 9** (Recommended for Enterprise HPC)
- **AlmaLinux 8 / 9**
- **Red Hat Enterprise Linux (RHEL) 8 / 9**
- **Ubuntu 22.04 / 24.04 LTS**
- **Debian 11 / 12**

### Minimum Hardware Prerequisites
| Resource | Minimum Required | Recommended Production |
| :--- | :--- | :--- |
| **CPU Architecture** | x86_64 or aarch64 (2 Cores) | 4+ Cores |
| **System Memory (RAM)**| 4 GB | 8 GB+ |
| **Storage Capacity** | 20 GB free disk space | 50 GB+ NVMe/SSD |
| **Network Interfaces** | 1 GbE dedicated management port | 10 GbE / 25 GbE redundant ports |

---

## Package Contents

```
ayalhpc/
├── deploy.sh                  # Interactive, idempotent production installer
├── README.md                  # This deployment and administration guide
├── config/
│   ├── .env.example           # Production environment template
│   └── package_catalog.yaml   # HPC software and environment module catalog
├── backend/                   # FastAPI asynchronous backend application
│   ├── app/                   # Core controllers, services, models, and APIs
│   ├── requirements.txt       # Python package dependencies
│   └── alembic/               # Database migration scripts
├── frontend/
│   ├── dist/                  # Pre-compiled high-performance Single Page Application
│   ├── src/                   # React 18, Vite, and Ant Design UI source
│   └── package.json           # Frontend dependency manifest
├── services/                  # Systemd service units & Nginx reverse proxy configurations
│   ├── ajicorehpc-backend.service# Systemd service for backend daemon
│   ├── ajicorehpc.target         # Systemd target aggregator
│   └── nginx-ajicorehpc.conf     # Hardened Nginx reverse proxy configuration
├── scripts/
│   └── issue_license.py       # Vendor licensing verification utility
└── docs/                      # Architectural specifications and deployment manuals
```

---

## Rapid Deployment Guide

### Step 1: Extract the Package
```bash
unzip ajicorehpc.zip
cd ajicorehpc
```

### Step 2: Execute the Production Installer
Run the installer with root privileges:
```bash
sudo chmod +x deploy.sh
sudo ./deploy.sh
```

#### Non-Interactive / Automated Deployment
For automated CI/CD or headless kickstart provisioning:
```bash
sudo ./deploy.sh --non-interactive --port 80 --db-type postgres
```

The installer automatically:
1. Detects your Linux distribution and verifies hardware capabilities.
2. Creates the unprivileged `ajicorehpc` service account.
3. Installs Python 3.11+, Nginx, PostgreSQL, Redis, and system dependencies.
4. Initializes Python virtual environments and compiles application dependencies.
5. Configures database schemas and seeds default RBAC permissions.
6. Installs and enables the `ajicorehpc-backend.service` and `ajicorehpc.target` systemd daemons.
7. Configures Nginx reverse proxy with WebSocket support and security headers.
8. Configures `firewalld` or `ufw` firewall rules.

---

## First-Run Onboarding & Licensing Wizard

Upon completion of the installer, navigate to your server's IP address:
```
http://<YOUR-SERVER-IP>/setup
```

The 5-stage setup wizard guides you through:
1. **Microsoft 365 SMTP Integration**: Connect your enterprise Office 365 credentials via STARTTLS on port 587 and run an automated handshake probe.
2. **Customer Registration**: Register your Organization Name, Administrator Email, Country, and Deployment Tier. The platform deterministically computes your unique **Customer ID** (`AJICORE-CUST-YYYYMM-XXXX`) and **Hardware Installation ID** (`AJICORE-INST-<12-hex-hash>`).
3. **Email Confirmation**: Validate ownership via a 6-digit cryptographic verification PIN delivered to your registered email.
4. **License Activation**: Activate your perpetual or subscription license signed with asymmetric Ed25519 cryptography.
5. **Admin Account Finalization**: Set up your primary cluster administrator credentials and access your dashboard.

---

## Service Management & Troubleshooting

### Check Service Status
```bash
# Check backend status
systemctl status ajicorehpc-backend.service

# Check Nginx status
systemctl status nginx

# Check overall target
systemctl status ajicorehpc.target
```

### View Real-Time Logs
```bash
# Live backend logs
journalctl -u ajicorehpc-backend.service -f

# Nginx access & error logs
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Restart Services
```bash
sudo systemctl restart ajicorehpc.target
```

---

## Security Specifications
- **Zero Legacy IP / Pre-Configured State**: AYAL HPC starts in a clean zero-configuration state. Clusters, nodes, and credentials are configured dynamically.
- **Asymmetric Licensing**: Uses Ed25519 digital signatures to guarantee license authenticity and hardware installation binding without phone-home requirements.
- **Role-Based Access Control (RBAC)**: Fine-grained permissions covering cluster nodes, job queues, shared storage, and out-of-band power controls.
- **Secure Secret Storage**: High-entropy JWT secrets and database passwords with restricted filesystem permissions (`chmod 0600`).
