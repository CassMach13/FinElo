"""Package R2 architectural stop, preserving native FAILs and immutable history."""
import argparse
import hashlib
import json
import re
import runpy
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'node_modules/.finelo-cycle4d-r1-tools'
OUT = TOOLS / 'evidence'
COMPACT = ROOT / 'docs/temas/evidencias-ciclo-4d-r2'
HISTORICAL_SHA = '12d8c7fa215cbb828eb0dd251898e12f0683371a0f08fc1dc731d10d26126456'
def digest(data): return hashlib.sha256(data).hexdigest()
def encode(value): return json.dumps(value, ensure_ascii=False, indent=2).encode('utf8')

def package(previous, target):
    assert not target.exists(), 'Never overwrite evidence'
    assert digest(previous.read_bytes()) == HISTORICAL_SHA
    baseline = json.loads((OUT/'r2-baseline-final-matrix.json').read_text(encoding='utf8'))
    boundary = json.loads((OUT/'r2-boundary-matrix.json').read_text(encoding='utf8'))
    retries = json.loads((OUT/'r2-timeout-retries.json').read_text(encoding='utf8'))
    assert len(baseline) == 48 and len({r['name']for r in baseline}) == 48
    assert len(boundary) == 4
    def counts(rows):
        return {'total':len(rows), 'PASS':sum(r['status']=='PASS'for r in rows),
                'FAIL':sum(r['status']=='FAIL'for r in rows),
                'safetyFailures':sum(bool(r.get('safetyFailure')or r.get('counterexampleReproduced'))for r in rows),
                'unexpectedFailures':sum(bool(r.get('harnessOrUnexpectedFailure'))for r in rows)}
    excluded = {'resourcesBefore','resourcesAfter','financialSHA256','traceback'}
    metrics = {'base':'11e58ddcd4dc68978cbea401e4c13a72c87fbc7a','verdict':'NO-GO',
        'productChanged':False,'implementation':'NOT IMPLEMENTED: additional SW policy authorization required by step 3',
        'acceptance':'NOT MET: no 48/48 PASS and adversarial approval',
        'baselineCounts':counts(baseline),'baseline':[ {k:v for k,v in row.items()if k not in excluded}for row in baseline],
        'sameDeadlineRetryCounts':counts(retries),'sameDeadlineRetries':[{k:v for k,v in row.items()if k not in excluded}for row in retries],
        'boundaryCounts':counts(boundary),'boundary':boundary,
        'localValidation':json.loads((OUT/'r2-local-validation.json').read_text(encoding='utf8')),
        'remoteAuth':'BLOCKED','physicalInstalledPWA':'NOT TESTED',
        'adversarialAcceptance':'NOT TESTED: complete protocol not installed; see report for individual scope',
        'historicalR1ArchiveSHA256':HISTORICAL_SHA}
    (COMPACT/'metrics.json').write_bytes(encode(metrics))
    images=[]
    for suffix in ['before','after']:
        name='r2-boundary-chrome-original-'+suffix+'.png'
        data=(OUT/name).read_bytes();(COMPACT/name).write_bytes(data)
        images.append({'path':name,'bytes':len(data),'sha256':digest(data)})
    rows=[];objects={}
    def add(label,data):
        hashed=digest(data);obj='objects/'+hashed
        rows.append({'path':label,'bytes':len(data),'sha256':hashed,'object':obj});objects.setdefault(obj,data)
    with zipfile.ZipFile(previous)as old:
        assert old.testzip() is None
        old_index=json.loads(old.read('index.json'))
        for row in old_index['files']:
            if row['path'].startswith(('raw-artifacts/','sources/','reproduction/')):
                data=old.read(row['object']);assert digest(data)==row['sha256'] and len(data)==row['bytes']
                add('historical-r1/'+row['path'],data)
    for file in sorted(OUT.glob('r2*')):
        if file.is_file()and file.suffix in ['.json','.png']:add('evidence/'+file.name,file.read_bytes())
    for name in ['builds.json','regression-source.json']:
        add('evidence/'+name,(OUT/name).read_bytes())
    add('evidence/metrics.json',encode(metrics))
    # Only disposable synthetic runs. No environment dumps, profiles or private
    # root-workspace tests. Any credential-shaped line is removed explicitly.
    log_receipts=[]
    credential=re.compile(r'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|\bBearer\s+\S+|[\"\'](?:access_token|refresh_token|password|authorization)[\"\']\s*:',re.I)
    for file in sorted(TOOLS.glob('r2-*.log')):
        raw=file.read_bytes();text=raw.decode('utf8',errors='replace');redacted=0;lines=[]
        for line in text.splitlines(True):
            if credential.search(line):
                lines.append('[credential-shaped diagnostic line removed]\n');redacted+=1
            else:lines.append(line)
        sanitized=''.join(lines).encode('utf8')
        assert not credential.search(sanitized.decode('utf8'))
        add('sanitized-logs/'+file.name,sanitized)
        log_receipts.append({'file':file.name,'originalSHA256':digest(raw),'sanitizedSHA256':digest(sanitized),'removedLines':redacted})
    add('evidence/log-sanitization.json',encode(log_receipts))
    diagnostic=ROOT/'scripts/diagnostics'
    sources=[*diagnostic.glob('pwa-r2-*.py'),*diagnostic.glob('package-pwa-r2-*.py'),*(diagnostic/'pwa-r2').glob('*.js')]
    for file in sorted(sources):
        add('reproduction/'+file.relative_to(ROOT).as_posix(),file.read_bytes())
    for name in ['tests/appearance/pwaR2Boundary.spec.ts','docs/temas/ciclo-4d-r2-atualizacao-segura.md',
                 'docs/temas/proposta-fronteira-worker-4d-r2.patch','docs/temas/evidencias-ciclo-4d-r2/inventario-estados.json']:
        add('reproduction/'+name,(ROOT/name).read_bytes())
    checkpoint=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    index={'cycle':'4D-R2 architectural authorization boundary','sourceBase':checkpoint,
           'explicitNewSources':'reproduction/ paths; product sources unchanged from 11e58dd',
           'canonicalReport':'evidence/metrics.json','verdict':'NO-GO','files':rows}
    with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as archive:
        archive.writestr('index.json',encode(index))
        for name,data in objects.items():archive.writestr(name,data)
    verify=runpy.run_path(str(ROOT/'scripts/diagnostics/verify-theme-evidence.py'))['verify']
    first=verify(target);second=verify(target);assert first==second
    result={'archive':target.name,'sourceBase':checkpoint,'checks':[first,second],
            'images':images,'pngBytes':sum(r['bytes']for r in images),'verdict':'NO-GO','productChanged':False}
    (COMPACT/'manifest.json').write_bytes(encode(result))
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('previous',type=Path);parser.add_argument('target',type=Path)
    args=parser.parse_args();package(args.previous,args.target)
