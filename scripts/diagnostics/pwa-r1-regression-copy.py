"""Full versioned regression without untracked private invoices or environment files."""
import io
import json
import subprocess
import tarfile
from pathlib import Path
from pwa_r1_observation import ROOT, OUT, digest

if __name__ == '__main__':
    target = ROOT / 'scripts/diagnostics/theme-pwa-r1-regression'
    assert not target.exists(), 'Never overwrite a regression copy'
    target.mkdir()
    commit = subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    data = subprocess.check_output(['git','archive','--format=tar',commit],cwd=ROOT)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for member in archive.getmembers():
            resolved = (target / member.name).resolve()
            assert resolved.is_relative_to(target.resolve())
            assert not member.issym() and not member.islnk()
        archive.extractall(target,filter='data')
    overlays = ['.gitignore','scripts/diagnostics/integrated-pwa.config.ts','scripts/diagnostics/integrated-validate-pwa.py',
                'scripts/diagnostics/pwa-r1.config.ts','scripts/diagnostics/pwa-r1-observe.js',
                'scripts/diagnostics/pwa-r1-reconstruct.py','scripts/diagnostics/pwa-r1-validate.py',
                'scripts/diagnostics/pwa_r1_observation.py','tests/appearance/pwaDiagnosticBoundary.spec.ts']
    for name in overlays:
        output = target / name
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_bytes((ROOT / name).read_bytes())
    assert not list(target.glob('.env')) and not list(target.glob('.env.local'))
    receipt = {'base':commit,'source':'git archive plus explicit R1 overlays only','privateUntrackedFilesCopied':False,
               'overlays':{name:digest((ROOT/name).read_bytes())for name in overlays},'target':target.relative_to(ROOT).as_posix()}
    (OUT/'regression-source.json').write_text(json.dumps(receipt,indent=2),encoding='utf8')
    print(json.dumps(receipt,indent=2))
