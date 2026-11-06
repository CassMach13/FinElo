"""Import hyphenated diagnostic CLI helpers without executing their entry point."""
import runpy
from pathlib import Path
globals().update({k:v for k,v in runpy.run_path(str(Path(__file__).with_name('integrated-validate-navigation.py')),run_name='integrated_tools').items()if not k.startswith('__')})
