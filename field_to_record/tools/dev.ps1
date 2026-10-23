param([switch]$NoSpeech)
$root=Split-Path $PSScriptRoot -Parent
$python=Join-Path $root 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw 'Run the setup commands in README.md first.' }
$env:WHISPER_MODEL_PATH=Join-Path $root 'models/whisper-tiny.en'
$env:HF_HUB_OFFLINE='1'
$env:TRANSFORMERS_OFFLINE='1'
$env:DATABASE_PATH=Join-Path $root 'backend/field_to_record.sqlite3'
$env:WARM_SPEECH=if ($NoSpeech) {'0'} else {'1'}
$api=Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000','--app-dir',('"'+(Join-Path $root 'backend')+'"'),'--no-access-log') -WindowStyle Hidden -PassThru
try {
    Push-Location (Join-Path $root 'frontend')
    npm run dev
} finally {
    Pop-Location
    if (-not $api.HasExited) { Stop-Process -Id $api.Id }
}
