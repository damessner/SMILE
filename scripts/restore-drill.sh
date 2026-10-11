# Delegate to python restore_drill.py
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec /usr/bin/python3 "${SCRIPT_DIR}/restore_drill.py" "$@"