"""Compatibility entry point; shared-component validation now includes the shell and PDF."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name('validate-shared-themes.py')), run_name='__main__')
