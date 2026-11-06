"""Allowlisted synthetic PWA evidence, immutable ZIP, deduplicated by SHA-256."""
import argparse
import json
import re
import runpy
import subprocess
import zipfile
from pathlib import Path
from pwa_r1_observation import ROOT, TOOLS, OUT, digest

def encode(value):
    return json.dumps(value,ensure_ascii=False,indent=2).encode('utf8')

def package(destination):
    assert not destination.exists(), 'Never overwrite prior evidence'
    canonical = {row['name']:{**row,'report':'verified-matrix.json'} for row in json.loads((OUT/'verified-matrix.json').read_text(encoding='utf8'))}
    for row in json.loads((OUT/'navigation-confirmation.json').read_text(encoding='utf8')):
        canonical[row['name']]={**row,'report':'navigation-confirmation.json','priorWaitingObservationRetained':True}
    assert len(canonical)==30
    assert sum(row['status']=='PASS' for row in canonical.values())==28
    assert sum(row.get('knownOriginalPolicyFailure',False) for row in canonical.values())==2
    assert not any(row.get('unexpected')for row in canonical.values())
    summary={'cases':list(canonical.values()),'counts':{'total':30,'PASS':28,'FAIL':2},
             'proposal':{'cases':8,'PASS':8,'appliedToProduct':False},
             'remoteAuth':'BLOCKED','osInstalledPWA':'NOT TESTED','overallVerdict':'NO-GO',
             'openObservation':'An instrumented original-policy control once remained waiting with a prompt; not reproduced on targeted repeat. Same-instance recovery NOT TESTED; preserved, not declared fixed.',
             'localValidation':json.loads((OUT/'local-validation.json').read_text(encoding='utf8'))}
    (OUT/'canonical-summary.json').write_bytes(encode(summary))
    compact=ROOT/'docs/temas/evidencias-ciclo-4d-r1'
    compact.mkdir(exist_ok=True)
    images=['before-old-document.png','msedge-original-original-update-ui-restored-light.png',
            'msedge-proposed-prompt-original-update-ui-light.png','chrome-proposed-prompt-original-update-ui-restored-light.png']
    image_rows=[]
    for name in images:
        content=(OUT/name).read_bytes();(compact/name).write_bytes(content)
        image_rows.append({'file':name,'bytes':len(content),'sha256':digest(content)})
    (compact/'metrics.json').write_bytes(encode(summary))
    rows=[];objects={}
    def add(path,label):
        content=path.read_bytes()
        if path.suffix=='.json' and re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|"(?:access_token|refresh_token|password|authorization)"\s*:',content):
            raise ValueError('Credential-shaped data in '+label)
        hashed=digest(content);key='objects/'+hashed
        rows.append({'path':label,'bytes':len(content),'sha256':hashed,'object':key});objects.setdefault(key,content)
    for path in sorted(OUT.rglob('*')):
        if path.is_file()and path.suffix in ['.json','.png']:
            add(path,'evidence/'+path.relative_to(OUT).as_posix())
    corrected=ROOT/'node_modules/.finelo-cycle4d-tools/evidence'
    for path in sorted(corrected.glob('pwa-*')):
        if path.suffix in ['.json','.png']:add(path,'corrected-harness/'+path.name)
    # Bundle precached artifacts only; no videos, profiles or arbitrary public files.
    for family in ['builds','builds-observed']:
        for directory in sorted((TOOLS/family).iterdir()):
            sw=(directory/'sw.js').read_text(encoding='utf8')
            names={'index.html','sw.js',*re.findall(r'url:"([^"]+)"',sw),*[p.name for p in directory.glob('workbox-*.js')]}
            for name in sorted(names):
                path=directory/name
                assert path.resolve().is_relative_to(directory.resolve()) and path.is_file(),name
                add(path,f'artifacts/{family}/{directory.name}/{name}')
    source_names=subprocess.check_output(['git','ls-files','-z','--','src'],cwd=ROOT).decode().split('\0')
    for name in filter(None,source_names):add(ROOT/name,'sources/'+name)
    for path in sorted((ROOT/'scripts/diagnostics').iterdir()):
        if path.is_file()and(path.name.startswith(('pwa-r1','pwa_r1','integrated','package-pwa-r1'))or path.name in ['remaining-fixtures.ts','investment-fixtures.ts','verify-theme-evidence.py']):
            add(path,'reproduction/'+path.relative_to(ROOT).as_posix())
    for name in ['vite.config.ts','index.html','package.json','package-lock.json','tsconfig.json','tailwind.config.js',
                 'docs/temas/ciclo-4d-r1-pwa.md','docs/temas/proposta-pwa-prompt-4d-r1.patch','tests/appearance/pwaDiagnosticBoundary.spec.ts']:
        path=ROOT/name
        if path.exists():add(path,'reproduction/'+name)
    for name in json.loads((OUT/'regression-source.json').read_text(encoding='utf8'))['overlays']:
        add(ROOT/'scripts/diagnostics/theme-pwa-r1-regression'/name,'full-regression-overlays/'+name)
    checkpoint=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    manifest={'cycle':'4D-R1','reviewed':'c7f1a5c668ef4f39b9b0d489a93c02fa07e72308','sourceCheckpoint':checkpoint,
              'verdict':'NO-GO','canonicalReport':'evidence/canonical-summary.json','files':rows}
    with zipfile.ZipFile(destination,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as archive:
        archive.writestr('index.json',encode(manifest))
        for name,content in objects.items():archive.writestr(name,content)
    verify=runpy.run_path(str(ROOT/'scripts/diagnostics/verify-theme-evidence.py'))['verify']
    first=verify(destination);second=verify(destination);assert first==second
    receipt={'archive':destination.name,'sourceCheckpoint':checkpoint,'checks':[first,second],
             'images':image_rows,'pngBytes':sum(row['bytes']for row in image_rows),'productionPolicyApplied':False}
    (compact/'manifest.json').write_bytes(encode(receipt))
    print(json.dumps(receipt,ensure_ascii=True,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);package(parser.parse_args().archive)
