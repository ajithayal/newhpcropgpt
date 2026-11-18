import pytest
from app.reconcile.handlers import (
    UserReconcileHandler,
    NfsReconcileHandler,
    AppsStorageReconcileHandler,
)
from app.remote.ssh_executor import SSHResult


def test_user_handler_create_success(fake_ssh):
    """Verifies user creation generates correct commands and passes read-back."""
    payload = {
        "username": "johndoe",
        "uid": 10500,
        "gid": 10500,
        "home_directory": "/home/johndoe",
        "shell": "/bin/bash",
        "password": "SecretPassword123!",
        "quota_hard_gb": 100,
        "quota_soft_gb": 80,
    }

    success, logs, err = UserReconcileHandler.apply("10.0.1.10", "user_create", payload)

    assert success is True
    assert err == ""
    assert "Created POSIX user 'johndoe'" in logs
    assert "Set password for user 'johndoe'" in logs
    assert "Applied storage quota on /home for UID 10500" in logs
    assert "Verified user identity" in logs

    # Verify executed commands in fake_ssh
    cmd_texts = [cmd for host, cmd, stdin in fake_ssh.commands_executed]
    assert any("useradd -u 10500" in cmd for cmd in cmd_texts)
    assert any("chpasswd" in cmd for cmd in cmd_texts)
    assert any("xfs_quota" in cmd for cmd in cmd_texts)
    assert any("getent passwd johndoe" in cmd for cmd in cmd_texts)

    # Verify password was passed via stdin, not on the CLI command
    chpasswd_calls = [(cmd, stdin) for host, cmd, stdin in fake_ssh.commands_executed if "chpasswd" in cmd]
    assert len(chpasswd_calls) == 1
    assert chpasswd_calls[0][1] == "johndoe:SecretPassword123!\n"


def test_user_handler_idempotent_existing_user(fake_ssh):
    """When user already exists, UserReconcileHandler gracefully updates attributes without duplicate errors."""
    fake_ssh.set_response("id -u johndoe", SSHResult(0, "10500", "", 0.5))

    payload = {
        "username": "johndoe",
        "uid": 10500,
        "gid": 10500,
        "home_directory": "/home/johndoe",
        "shell": "/bin/zsh",
    }

    success, logs, err = UserReconcileHandler.apply("10.0.1.10", "user_create", payload)

    assert success is True
    assert "already exists on 10.0.1.10" in logs
    assert "Updating parameters" in logs


def test_user_handler_verification_failure(fake_ssh):
    """If getent read-back fails after useradd, the handler must report failure."""
    fake_ssh.set_response("getent passwd", SSHResult(1, "", "getent failed", 0.5))

    payload = {
        "username": "ghostuser",
        "uid": 10501,
        "gid": 10501,
    }

    success, logs, err = UserReconcileHandler.apply("10.0.1.10", "user_create", payload)

    assert success is False
    assert "Verification failed" in err


def test_nfs_export_success(fake_ssh):
    """Verifies nfs_export writes export configuration and checks exportfs -v."""
    payload = {
        "path": "/apps",
        "subnet": "10.0.1.0/24",
        "options": "rw,sync,no_root_squash,no_subtree_check",
    }

    success, logs, err = NfsReconcileHandler.apply("10.0.1.10", "nfs_export", payload)

    assert success is True
    assert "Wrote export '/apps 10.0.1.0/24(rw,sync,no_root_squash,no_subtree_check)'" in logs
    assert "Verified NFS export active" in logs


def test_nfs_mount_success(fake_ssh):
    """Verifies nfs_mount adds fstab entry and verifies findmnt."""
    payload = {
        "server_ip": "10.0.1.10",
        "server_path": "/apps",
        "mount_point": "/apps",
    }

    success, logs, err = NfsReconcileHandler.apply("10.0.1.20", "nfs_mount", payload)

    assert success is True
    assert "Configured fstab and triggered mount for /apps" in logs
    assert "Verified active mount" in logs


def test_apps_storage_safety_block_mounted_disk(fake_ssh):
    """AppsStorageReconcileHandler blocks wiping if disk has an active mount point."""
    fake_ssh.set_response(
        "lsblk -J -o PATH,MOUNTPOINT,FSTYPE /dev/sdb",
        SSHResult(0, '{"blockdevices":[{"path":"/dev/sdb","mountpoint":"/data"}]}', "", 0.5),
    )

    payload = {"device": "/dev/sdb"}
    success, logs, err = AppsStorageReconcileHandler.apply("10.0.1.10", "apps_storage_create", payload)

    assert success is False
    assert "Safety Violation" in err
    assert "currently mounted at '/data'" in err


def test_apps_storage_safety_require_wipe_confirmation(fake_ssh):
    """If disk has existing filesystem/partitions, confirm_wipe matching device name is required."""
    fake_ssh.set_response(
        "lsblk -J -o PATH,MOUNTPOINT,FSTYPE /dev/sdb",
        SSHResult(0, '{"blockdevices":[{"path":"/dev/sdb","fstype":"ext4"}]}', "", 0.5),
    )

    # Without confirmation -> blocked
    payload = {"device": "/dev/sdb"}
    success, logs, err = AppsStorageReconcileHandler.apply("10.0.1.10", "apps_storage_create", payload)
    assert success is False
    assert "Safety Protection" in err

    # With correct confirmation -> proceeds
    payload_confirmed = {"device": "/dev/sdb", "confirm_wipe": "sdb"}
    success2, logs2, err2 = AppsStorageReconcileHandler.apply("10.0.1.10", "apps_storage_create", payload_confirmed)
    assert success2 is True
    assert "Safety checks passed" in logs2
    assert "Created GPT partition on /dev/sdb" in logs2
    assert "Formatted /dev/sdb1 with XFS" in logs2
    assert "Verified active mount for /apps" in logs2
