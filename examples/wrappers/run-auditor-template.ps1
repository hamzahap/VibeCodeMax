param()

$prompt = Get-Content -LiteralPath $env:VCM_PROMPT_FILE -Raw
$packet = Get-Content -LiteralPath $env:VCM_AUDIT_PACKET_FILE -Raw

Write-Host "Auditor wrapper template"
Write-Host "Audit packet: $env:VCM_AUDIT_PACKET_FILE"
Write-Host "Model: $env:VCM_MODEL"
Write-Host ""
Write-Host "Edit this file to call your preferred auditor agent."
Write-Host "The auditor must print JSON to stdout."
Write-Host ""
Write-Host '{"decision":"continue","summary":"Not wired yet","nextPrompt":"Wire the auditor wrapper."}'

exit 1
