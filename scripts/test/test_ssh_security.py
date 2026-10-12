import unittest
import os
import sys
import paramiko

# Add parent directory (scripts) to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from ssh_utils import create_ssh_client


class TestSshSecurity(unittest.TestCase):
    def test_client_enforces_reject_policy(self):
        client = create_ssh_client()
        policy = client._policy
        self.assertIsInstance(
            policy,
            paramiko.RejectPolicy,
            "SSH client must enforce RejectPolicy instead of AutoAddPolicy",
        )

    def test_unknown_host_key_is_rejected(self):
        client = create_ssh_client()
        policy = client._policy
        client._transport = unittest.mock.MagicMock()
        fake_key = paramiko.RSAKey.generate(1024)
        with self.assertRaises(paramiko.SSHException) as ctx:
            policy.missing_host_key(client, "unknown-untrusted-host.internal", fake_key)

        self.assertIn("not found in known_hosts", str(ctx.exception).lower())


if __name__ == '__main__':
    unittest.main()
