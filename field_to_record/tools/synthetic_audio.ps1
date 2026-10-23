param([string]$OutputDirectory = "$PSScriptRoot/../data/audio")
# This synthesizes fictional dictations locally using the Windows installed voice.
Add-Type -AssemblyName System.Speech
$output = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $output | Out-Null
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = -1
$cases = @(
    @{name='medication';text='At fourteen oh five, gave five milligrams of fictional agent X intravenously.'},
    @{name='observations';text='At fourteen ten, recorded blood pressure one twenty over eighty. At fourteen twelve performed bandaging.'},
    @{name='negation';text='No fictional agent X was administered. Patient refused medication.'}
)
foreach ($case in $cases) {
    $speaker.SetOutputToWaveFile((Join-Path $output ($case.name + '.wav')))
    $speaker.Speak($case.text)
    $speaker.SetOutputToNull()
}
$speaker.Dispose()
Write-Output 'Generated local synthetic audio; these are not human-recorded evaluation samples.'
