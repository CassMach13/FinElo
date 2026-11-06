"""Restore only verified synthetic R1 build artifacts for a new R2 baseline run.

Never replaces historical evidence or loads browser profiles/environment files.
"""
import argparse
import hashlib
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'node_modules/.finelo-cycle4d-r1-tools'
EXPECTED = '12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456'

def restore(path):
    assert hashlib.sha256(path.read_bytes()).hexdigest() == EXPECTED
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None
        manifest = json.loads(archive.read('index.json'))
        checked = set()
        for row in manifest['files']:
            data = archive.read(row['object'])
            assert len(data) == row['bytes']
            assert hashlib.sha256(data).hexdigest() == row['sha256']
            checked.add(row['object'])
        selected = []
        for row in manifest['files']:
            name = row['path']
            if name.startswith('raw-artifacts/'):
                destination = TOOLS / 'builds' / name.removeprefix('raw-artifacts/')
            elif name == 'evidence/builds.json':
                destination = TOOLS / 'evidence/builds.json'
            else:
                continue
            assert destination.resolve().is_relative_to(TOOLS.resolve())
            assert not destination.exists(), 'Never overwrite a replay artifact'
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(archive.read(row['object']))
            selected.append({'path': name, 'sha256': row['sha256']})
    receipt = {'sourceSHA256': EXPECTED, 'historicalObjectsVerified': len(checked),
               'copied': selected, 'historicalEvidenceModified': False,
               'meaning': 'New baseline replay of unchanged R1 product; not an R2 implementation'}
    (TOOLS / 'evidence/r2-restore.json').write_text(json.dumps(receipt, indent=2), encoding='utf8')
    print(json.dumps({'copied': len(selected), 'verified': len(checked), 'sourceSHA256': EXPECTED}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive', type=Path)
    restore(parser.parse_args().archive)
