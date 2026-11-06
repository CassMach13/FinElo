"""Export the isolated reference by layer. Never generates/applies a product patch."""
import difflib,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
groups={'interface':['client.js','index.html','style.css'],
        'worker':['worker.js'],
        'migracao':['neutral.html','server.py','validate.py','legacy.py']}
receipt={}
for layer,names in groups.items():
    patch=''
    for name in names:
        relative='scripts/diagnostics/pwa-r2b/'+name
        text=(ROOT/relative).read_text(encoding='utf8').replace('\r\n','\n')
        patch+=f'diff --git a/{relative} b/{relative}\nnew file mode 100644\n'
        patch+=''.join(difflib.unified_diff([],text.splitlines(True),fromfile='/dev/null',tofile='b/'+relative))
    target=ROOT/f'docs/temas/proposta-r2b-{layer}.patch';target.write_bytes(patch.encode('utf8'))
    receipt[layer]={'path':target.relative_to(ROOT).as_posix(),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'files':names,'productPaths':[]}
print(json.dumps(receipt,indent=2))
