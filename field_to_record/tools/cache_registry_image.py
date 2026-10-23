"""Cache a public Docker Hub image via the host network as a verified Docker archive.

Useful when Docker Desktop's proxy is unavailable. Does not change daemon settings.
"""
import argparse,gzip,hashlib,json,shutil,tarfile,tempfile
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode

parser=argparse.ArgumentParser()
parser.add_argument('image',help='Docker Hub repository:tag')
parser.add_argument('archive',type=Path)
args=parser.parse_args()
repository,tag=args.image.rsplit(':',1)
if '/' not in repository: repository='library/'+repository
base='https://registry-1.docker.io/v2/'+repository
with urlopen('https://auth.docker.io/token?'+urlencode({'service':'registry.docker.io','scope':'repository:'+repository+':pull'}),timeout=30) as response:
    token=json.load(response)['token']
headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'}
def read(path):
    with urlopen(Request(base+path,headers=headers),timeout=60) as response: return response.read()
manifest=json.loads(read('/manifests/'+tag))
if 'manifests' in manifest:
    selected=next(item for item in manifest['manifests'] if item.get('platform',{}).get('os')=='linux' and item['platform'].get('architecture')=='amd64')
    manifest=json.loads(read('/manifests/'+selected['digest']))
config_bytes=read('/blobs/'+manifest['config']['digest'])
assert 'sha256:'+hashlib.sha256(config_bytes).hexdigest()==manifest['config']['digest']
config=json.loads(config_bytes)
args.archive.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp); config_name=manifest['config']['digest'].split(':')[1]+'.json'
    (root/config_name).write_bytes(config_bytes); layer_names=[]
    for index,layer in enumerate(manifest['layers']):
        compressed=root/(str(index)+'.compressed')
        with urlopen(Request(base+'/blobs/'+layer['digest'],headers={'Authorization':'Bearer '+token}),timeout=120) as response,compressed.open('wb') as output:
            shutil.copyfileobj(response,output)
        actual=hashlib.sha256(compressed.read_bytes()).hexdigest()
        assert 'sha256:'+actual==layer['digest'],'Compressed layer digest mismatch'
        directory=root/actual; directory.mkdir(); target=directory/'layer.tar'
        if layer.get('mediaType','').endswith(('+gzip','.gzip')):
            with gzip.open(compressed,'rb') as source,target.open('wb') as output: shutil.copyfileobj(source,output)
        else: shutil.copyfile(compressed,target)
        diff=hashlib.sha256(target.read_bytes()).hexdigest()
        assert 'sha256:'+diff==config['rootfs']['diff_ids'][index],'Uncompressed layer digest mismatch'
        layer_names.append(actual+'/layer.tar')
        print(f'Verified layer {index+1}/{len(manifest["layers"])}',flush=True)
    (root/'manifest.json').write_text(json.dumps([{'Config':config_name,'RepoTags':[args.image],'Layers':layer_names}]),encoding='utf-8')
    with tarfile.open(args.archive,'w') as archive:
        for name in [config_name,'manifest.json',*layer_names]: archive.add(root/name,arcname=name)
print('Cached '+args.image+' -> '+str(args.archive))
