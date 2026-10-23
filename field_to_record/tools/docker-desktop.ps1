param([Parameter(ValueFromRemainingArguments=$true)][string[]]$DockerArgs)
# Local recovery client when Docker Desktop's Windows named-pipe bridge is stuck.
# Uses the installed Linux CLI/plugins and the existing engine; no daemon reset.
$ErrorActionPreference='Stop'
function Convert-ToDockerPath([string]$path) {
    $absolute=[IO.Path]::GetFullPath($path)
    if ($absolute -notmatch '^[A-Za-z]:\\') { throw 'This recovery helper expects a local Windows drive path.' }
    return '/mnt/host/'+$absolute.Substring(0,1).ToLowerInvariant()+'/'+$absolute.Substring(3).Replace('\','/')
}
$root=Split-Path $PSScriptRoot -Parent
$config=Join-Path $env:TEMP 'ftr-docker-client'
New-Item -ItemType Directory -Force -Path $config | Out-Null
@{cliPluginsExtraDirs=@('/mnt/host/wsl/docker-desktop/cli-tools/usr/local/lib/docker/cli-plugins')} | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $config 'config.json')
$previousWslEnv=$env:WSLENV
try {
    $env:WSLENV=(@($previousWslEnv,'OFFLINE_BUILD','MODEL_DIR','WHISPER_CPU_THREADS','MAX_SPEECH_SESSIONS','POSTGRES_PASSWORD','RECORD_ENCRYPTION_KEY') | Where-Object {$_}) -join ':'
    & wsl.exe -d docker-desktop --cd (Convert-ToDockerPath $root) -- env DOCKER_HOST=unix:///run/guest-services/docker.proxy.sock ('DOCKER_CONFIG='+(Convert-ToDockerPath $config)) /mnt/host/wsl/docker-desktop/cli-tools/usr/bin/docker @DockerArgs
    $result=$LASTEXITCODE
} finally { $env:WSLENV=$previousWslEnv }
exit $result
