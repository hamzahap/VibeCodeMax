param()

$prompt = Get-Content -LiteralPath $env:VCM_PROMPT_FILE -Raw

Write-Host "Primary agent wrapper template"
Write-Host "Workspace: $env:VCM_WORKSPACE"
Write-Host "Attempt: $env:VCM_ATTEMPT"
Write-Host "Model: $env:VCM_MODEL"
Write-Host ""
Write-Host "Edit this file to call your preferred agent CLI."
Write-Host "Read the prompt from `$env:VCM_PROMPT_FILE and run against `$env:VCM_WORKSPACE."
Write-Host ""
Write-Host "Example shape only, not a guaranteed command:"
Write-Host '  your-agent-cli --model "$env:VCM_MODEL" --prompt-file "$env:VCM_PROMPT_FILE"'

Write-Error "Template wrapper only. Replace with your local agent invocation."
exit 1

