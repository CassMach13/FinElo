"""Retry only incomplete baseline observations; keep original results and deadline."""
import argparse
import json
import runpy
from pathlib import Path

module=runpy.run_path(str(Path(__file__).with_name('pwa-r1-applied-validate.py')),run_name='r2_retry_helpers')
out=module['OUT']
original=json.loads((out/'r2-baseline-final-matrix.json').read_text(encoding='utf8'))
assert len(original)==48
results=[]
for row in original:
    if not row.get('harnessOrUnexpectedFailure'):continue
    # Same installed runner, resources, waits and assertions. No timeout override.
    args=argparse.Namespace(channels=[row['channel']],transitions=[row['transition']],
        themes=[row['preference']],scenarios=[row['scenario']],label='r2-same-deadline-retry')
    current=module['run'](args)[0]
    current['originalAttempt']=row['name']
    current['originalReason']=row['reason']
    results.append(current)
    module['write']('r2-timeout-retries.json',results)
raise SystemExit(1 if any(row['status']!='PASS'for row in results)else 0)
