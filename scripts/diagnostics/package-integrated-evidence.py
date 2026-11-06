"""Package only allowlisted synthetic 4D evidence; never browser profiles or logs."""
import argparse,hashlib,json,re,subprocess,zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
TOOLS=ROOT/'node_modules/.finelo-cycle4d-tools'
COMPACT=ROOT/'docs/temas/evidencias-ciclo-4d'
def sha(data):return hashlib.sha256(data).hexdigest()
def encode(value):return json.dumps(value,ensure_ascii=False,indent=2).encode('utf8')
def build(target):
 if target.exists():raise FileExistsError('Refusing to overwrite an evidence archive')
 summary=json.loads((TOOLS/'evidence/summary.json').read_text(encoding='utf8'))
 COMPACT.mkdir(exist_ok=True)
 images=['edge-1440-dark-0-dashboard.png','edge-1440-light-0-dashboard.png','edge-390-dark-3-investments.png','edge-390-light-3-investments.png','auth-edge-modal-focus-restoration.png','pwa-failure.png']
 image_rows=[]
 for name in images:
  data=(TOOLS/'evidence'/name).read_bytes();(COMPACT/name).write_bytes(data)
  image_rows.append({'file':name,'bytes':len(data),'sha256':sha(data)})
 (COMPACT/'metrics.json').write_bytes(encode(summary))
 rows=[];objects={}
 def add(path,label):
  data=path.read_bytes()
  if path.suffix in {'.json','.txt'} and re.search(rb'eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]+\.|"(?:access_token|refresh_token|password|authorization)"\s*:',data):raise ValueError('Credential-shaped field in '+label)
  digest=sha(data);obj='objects/'+digest
  rows.append({'path':label,'bytes':len(data),'sha256':digest,'object':obj});objects.setdefault(obj,data)
 for path in sorted((TOOLS/'evidence').rglob('*')):
  if path.is_file()and path.suffix.lower()in{'.png','.json','.pdf','.csv','.xlsx'}:add(path,'evidence/'+path.relative_to(TOOLS/'evidence').as_posix())
 for baseline in ['main','reviewed']:
  folder=ROOT/f'scripts/diagnostics/theme-integrated-{baseline}-baseline'
  for path in sorted(folder.rglob('*')):
   if path.is_file():add(path,'baselines/'+baseline+'/'+path.relative_to(folder).as_posix())
 contract=json.loads((ROOT/'tests/appearance/integrated-product-baseline.json').read_text(encoding='utf8'))
 for name in contract['files']:add(ROOT/name,'current/'+name)
 for path in sorted((ROOT/'scripts/diagnostics').iterdir()):
  if path.is_file()and(path.name.startswith(('integrated','serve-integrated','package-integrated'))or path.name in ['remaining-fixtures.ts','investment-fixtures.ts','remaining_visual_checks.py','investment_visual_checks.py','import_visual_checks.py','financial_visual_checks.py','card_visual_checks.py','reconciliation_visual_checks.py','verify-theme-evidence.py']):add(path,'reproduction/'+path.relative_to(ROOT).as_posix())
 for name in ['package.json','package-lock.json','vite.config.ts','tests/appearance/integratedQaGate.spec.ts','tests/appearance/integrated-product-baseline.json','tests/appearance/remainingSessionPresentation.ts','docs/temas/ajustes-visuais-4d.patch','docs/temas/ciclo-4d-homologacao-integrada.md','docs/temas/ciclo-4d-roteiro-manual.md']:
  add(ROOT/name,'reproduction/'+name)
 source=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 manifest={'cycle':'4D','sourceCheckpoint':source,'approvedBaseline':contract['commit']if'commit'in contract else'56afa733bbc444e4d7d7be741e939a7b8c44bc99','verdict':'NO-GO; partial local verification only','remoteAuth':'BLOCKED','physicalDevices':'NOT TESTED','canonicalReports':['evidence/summary.json','evidence/auth-canonical.json'],'preliminaryReports':'Retained as preliminary; canonical reports override matching auth groups. PWA final remains FAIL.','files':rows}
 index=encode(manifest)
 with zipfile.ZipFile(target,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=9)as archive:
  archive.writestr('index.json',index)
  for name,data in objects.items():archive.writestr(name,data)
 import runpy
 verify=runpy.run_path(str(ROOT/'scripts/diagnostics/verify-theme-evidence.py'))['verify']
 first=verify(target);second=verify(target);assert first==second
 receipt={'archive':target.name,'sourceCheckpoint':source,'verdict':manifest['verdict'],'checks':[first,second],'images':image_rows,'pngBytes':sum(r['bytes']for r in image_rows),'excluded':['private invoices','environment files','credentials','browser profiles','dependency binaries','raw test logs']}
 (COMPACT/'manifest.json').write_bytes(encode(receipt));print(json.dumps(receipt,ensure_ascii=True,indent=2))

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('archive',type=Path);args=parser.parse_args();build(args.archive)
