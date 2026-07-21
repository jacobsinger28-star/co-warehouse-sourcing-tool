"""Test bootstrap for the live-scrape backend.

Puts the backend dir on sys.path (so `from geocoder import ...` works the same
way the app imports it) and points DATA_DIR at a throwaway temp dir BEFORE any
module is imported — geocoder.py / database.py resolve their SQLite paths from
DATA_DIR at import time, so this must happen first, and it keeps tests from
touching the real geo/listings caches.
"""
import os
import sys
import tempfile
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="cwsourcing-tests-"))
