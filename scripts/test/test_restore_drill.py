#!/usr/bin/env python3
"""
Unit tests for restore_drill.py and backup_independent.py
"""
import os
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

# Add scripts directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import restore_drill
import backup_independent

class TestRestoreDrill(unittest.TestCase):
    def test_safety_check_rejects_live_db_as_drill_target(self):
        with patch.dict(os.environ, {"DB_NAME": "smile_db", "DRILL_DB": "smile_db"}):
            with patch("restore_drill.load_env", return_value={}):
                with self.assertRaises(SystemExit) as cm:
                    restore_drill.main()
                self.assertEqual(cm.exception.code, 1)

    def test_missing_backup_directory_fails_cleanly(self):
        with tempfile.TemporaryDirectory() as empty_dir:
            with patch.dict(os.environ, {
                "BACKUP_DIR": empty_dir,
                "DB_NAME": "smile_db",
                "DRILL_DB": "smile_restore_drill",
            }):
                with patch("restore_drill.load_env", return_value={}):
                    with self.assertRaises(SystemExit) as cm:
                        restore_drill.main()
                    self.assertEqual(cm.exception.code, 1)

    def test_backup_independent_fails_if_cert_missing(self):
        with patch.dict(os.environ, {
            "INDEPENDENT_BACKUP_CERT": "/non/existent/path/cert.pem",
        }):
            with patch("backup_independent.load_env", return_value={}):
                with self.assertRaises(SystemExit) as cm:
                    backup_independent.main()
                self.assertEqual(cm.exception.code, 1)

if __name__ == "__main__":
    unittest.main()
