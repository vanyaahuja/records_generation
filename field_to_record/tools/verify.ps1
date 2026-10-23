$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$python=Join-Path $root 'backend/.venv/Scripts/python.exe'
function Run-Checked([string]$file,[string[]]$arguments) {
    & $file @arguments
    if ($LASTEXITCODE -ne 0) { throw "Verification failed: $file" }
}
Run-Checked $python @('-m','ruff','check',(Join-Path $root 'backend'),(Join-Path $root 'tools'),(Join-Path $root 'eval'),'--select','F','--exclude','.venv')
Run-Checked $python @((Join-Path $root 'tools/contracts.py'),'--check')
Run-Checked $python @('-m','pytest','-q',(Join-Path $root 'backend/tests'))
Run-Checked $python @((Join-Path $root 'eval/run.py'),'--check')
Push-Location (Join-Path $root 'frontend')
try { Run-Checked 'npm.cmd' @('run','build'); Run-Checked 'npm.cmd' @('run','test:e2e') }
finally { Pop-Location }
Run-Checked 'docker.exe' @('compose','-f',(Join-Path $root 'compose.yml'),'config','--quiet')
