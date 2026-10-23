"""Prepare Linux amd64 build dependencies using the host's working network."""
import json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
wheels=ROOT/'deploy/wheels'; wheels.mkdir(parents=True,exist_ok=True)
subprocess.check_call([sys.executable,'-m','pip','download','--only-binary=:all:','--platform','manylinux_2_28_x86_64','--platform','manylinux_2_27_x86_64','--platform','manylinux_2_17_x86_64','--platform','manylinux2014_x86_64','--implementation','cp','--python-version','311','--abi','cp311','--dest',str(wheels),'-c',str(ROOT/'backend/constraints.txt'),'-r',str(ROOT/'backend/requirements.txt'),'-r',str(ROOT/'backend/requirements-speech.txt'),'-r',str(ROOT/'backend/requirements-postgres.txt'),'uvloop'])
npm='npm.cmd' if os.name=='nt' else 'npm'
cache=ROOT/'deploy/npm-cache'; cache.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='ftr-npm-',ignore_cleanup_errors=True) as temp:
    for name in ['package.json','package-lock.json']: shutil.copyfile(ROOT/'frontend'/name,Path(temp)/name)
    subprocess.check_call([npm,'ci','--cache',str(cache)],cwd=temp)
lock=json.loads((ROOT/'frontend/package-lock.json').read_text(encoding='utf-8'))['packages']
rollup=lock['node_modules/rollup']['version']; esbuild=lock['node_modules/esbuild']['version']
for package in [f'@rollup/rollup-linux-x64-gnu@{rollup}',f'@rollup/rollup-linux-x64-musl@{rollup}',f'@esbuild/linux-x64@{esbuild}']:
    subprocess.check_call([npm,'cache','add',package,'--cache',str(cache)])
print('Linux amd64 build cache ready. Set OFFLINE_BUILD=1 before docker compose build.')
