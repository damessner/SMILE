"""
SSH connection utilities with strict host key verification.
"""
import os
import paramiko


def create_ssh_client(known_hosts_file: str | None = None) -> paramiko.SSHClient:
    """
    Create a Paramiko SSHClient configured with strict host key verification.
    
    Loads system host keys (~/.ssh/known_hosts), optional custom host keys file,
    or the path specified by the SSH_KNOWN_HOSTS environment variable.
    Enforces RejectPolicy to reject unknown host keys.
    """
    client = paramiko.SSHClient()
    client.load_system_host_keys()

    custom_hosts = known_hosts_file or os.environ.get('SSH_KNOWN_HOSTS')
    if custom_hosts and os.path.exists(custom_hosts):
        client.load_host_keys(custom_hosts)

    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    return client
