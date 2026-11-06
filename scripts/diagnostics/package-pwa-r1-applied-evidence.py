"""Package the authorized one-line change and every native QA failure explicitly."""
import argparse
import json
import re
import runpy
import subprocess
import zipfile
from pathlib import Path
from pwa_r1_observation import ROOT, TOOLS, OUT, digest

def encode(value):return json.dumps(value,ensure_ascii=False,indent=2).encode('utf8')

def package(target):
    assert not target.exists(),'Never overwrite an earlier evidence package'
    cases=json.loads((OUT/'applied-final-matrix.json').read_text(encoding='utf8'))
    assert len(cases)==48 and len({row['name']for row in cases})==48
    counts={'total':len(cases),'PASS':sum(row['status']=='PASS'for row in cases),'FAIL':sum(row['status']=='FAIL'for row in cases),
            'safetyFailures':sum(bool(row.get('safetyFailure'))for row in cases),'harnessOrUnexpectedFailures':sum(bool(row.get('harnessOrUnexpectedFailure'))for row in cases)}
    compact=ROOT/'docs/temas/evidencias-ciclo-4d-r1-aplicacao';compact.mkdir(exist_ok=True)
    summary={'counts':counts,'overallVerdict':'NO-GO','productChange':'vite.config.ts: skipWaiting true -> false only',
             'cases':[{key:value for key,value in row.items()if key not in ['resourcesBefore','resourcesAfter','financialSHA256','intentionalFinancialPostAttempts','traceback']}for row in cases],
             'intentionalSyntheticPostAttempts':sum(len(row.get('intentionalFinancialPostAttempts',[]))for row in cases),
             'rawWorkers':True,'remoteAuth':'BLOCKED','osInstalledPWA':'NOT TESTED',
             'localValidation':json.loads((OUT/'applied-local-validation.json').read_text(encoding='utf8'))}
    (OUT/'applied-summary.json').write_bytes(encode(summary));(compact/'metrics.json').write_bytes(encode(summary))
    names=['applied-final-msedge-legacy-to-current-light-tabs-dirty-waiting-1.png',
           'applied-final-msedge-legacy-to-current-light-tabs-dirty-1.png',
           'applied-final-chrome-legacy-to-current-light-tabs-pending-waiting-1.png',
           'applied-final-chrome-legacy-to-current-light-tabs-pending-1.png']
    images=[]
    for name in names:
        data=(OUT/name).read_bytes();(compact/name).write_bytes(data)
        images.append({'file':name,'bytes':len(data),'sha256':digest(data)})
    rows=[];objects={}
    def add(path,label):
        data=path.read_bytes()
        if path.suffix=='.json'and re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|"(?:access_token|refresh_token|password|authorization)"\s*:',data):raise ValueError('Credential-shaped data: '+label)
        hashed=digest(data);name='objects/'+hashed
        rows.append({'path':label,'bytes':len(data),'sha256':hashed,'object':name});objects.setdefault(name,data)
    for path in sorted(OUT.rglob('*')):
        if path.is_file()and path.suffix in ['.json','.png']:add(path,'evidence/'+path.relative_to(OUT).as_posix())
    for directory in sorted((TOOLS/'builds').iterdir()):
        sw=(directory/'sw.js').read_text(encoding='utf8')
        files={'index.html','sw.js',*re.findall(r'url:"([^"]+)"',sw),*[p.name for p in directory.glob('workbox-*.js')]}
        for name in sorted(files):
            path=directory/name
            assert path.resolve().is_relative_to(directory.resolve())and path.is_file()
            add(path,'raw-artifacts/'+directory.name+'/'+name)
    for name in filter(None,subprocess.check_output(['git','ls-files','-z','--','src'],cwd=ROOT).decode().split('\0')):
        add(ROOT/name,'sources/'+name)
    for path in sorted((ROOT/'scripts/diagnostics').iterdir()):
        if path.is_file()and(path.name.startswith(('pwa-r1','pwa_r1','integrated','package-pwa-r1'))or path.name in ['remaining-fixtures.ts','investment-fixtures.ts','verify-theme-evidence.py']):
            add(path,'reproduction/'+path.relative_to(ROOT).as_posix())
    for name in ['vite.config.ts','index.html','package.json','package-lock.json','tsconfig.json','server/open-finance-paused.js',
                 'docs/temas/ciclo-4d-r1-pwa.md','docs/temas/proposta-pwa-prompt-4d-r1.patch','tests/appearance/pwaDiagnosticBoundary.spec.ts']:
        add(ROOT/name,'reproduction/'+name)
    receipt=json.loads((OUT/'regression-source.json').read_text(encoding='utf8'))
    for name in receipt['overlays']:add(ROOT/'scripts/diagnostics/theme-pwa-r1-regression'/name,'full-regression-overlays/'+name)
    checkpoint=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    manifest={'cycle':'4D-R1 authorized application','reviewed':'9c792eefd4c4773128c52708a99d5e65e7f89782','sourceCheckpoint':checkpoint,
              'canonicalReport':'evidence/applied-summary.json','verdict':'NO-GO','files':rows}
    with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as archive:
        archive.writestr('index.json',encode(manifest))
        for name,data in objects.items():archive.writestr(name,data)
    verify=runpy.run_path(str(ROOT/'scripts/diagnostics/verify-theme-evidence.py'))['verify']
    first=verify(target);second=verify(target);assert first==second
    result={'archive':target.name,'sourceCheckpoint':checkpoint,'checks':[first,second],'images':images,
            'pngBytes':sum(row['bytes']for row in images),'productChangeApplied':True,'overallVerdict':'NO-GO'}
    (compact/'manifest.json').write_bytes(encode(result));print(json.dumps(result,ensure_ascii=True,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);package(parser.parse_args().archive)
