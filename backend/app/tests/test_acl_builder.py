import pytest
from app.remote.commands import CommandBuilder


def test_acl_command_builder():
    """Verifies CommandBuilder.acl_set generates correct recursive and default setfacl commands."""
    cmd = CommandBuilder.acl_set("/apps/compilers", "hpcusers", "r-x")

    # Must contain both recursive -m and default -d -m
    assert "setfacl -R -m g:hpcusers:r-x /apps/compilers" in cmd
    assert "setfacl -R -d -m g:hpcusers:r-x /apps/compilers" in cmd


def test_acl_command_builder_shlex_quote():
    """Verifies paths with spaces or special characters are safely escaped."""
    cmd = CommandBuilder.acl_set("/apps/Special Tools", "hpc group", "rwx")

    assert "'/apps/Special Tools'" in cmd
    assert "g:'hpc group':rwx" in cmd


def test_user_command_builders():
    """Verifies CommandBuilder escapes usernames and shell arguments."""
    u_cmd = CommandBuilder.user_create("test;rm -rf /", 10001, 10001, "/home/test")
    assert "'test;rm -rf /'" in u_cmd  # Safely quoted, not executable

    ch_cmd, stdin_data = CommandBuilder.user_chpasswd("alice", "My$ecret&Pass!")
    assert ch_cmd == "chpasswd"
    assert stdin_data == "alice:My$ecret&Pass!\n"
