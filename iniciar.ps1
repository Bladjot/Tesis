$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    throw 'Instala Python 3.10 o posterior y vuelve a ejecutar este archivo.'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'Instala Node.js 22.12 o posterior y vuelve a ejecutar este archivo.'
}
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno Python.' }
}
& $pythonPath -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias Python.' }
Push-Location -LiteralPath (Join-Path $projectRoot 'frontend')
try {
    if (-not (Test-Path -LiteralPath node_modules)) {
        npm ci
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias de la interfaz.' }
    }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar la interfaz.' }
}
finally { Pop-Location }
Write-Host ''
Write-Host 'MyoHand: http://127.0.0.1:8765'
Write-Host 'Abre esa direccion en Chrome o Edge. Ctrl+C detiene el servicio.'
Write-Host ''
& $pythonPath -m uvicorn backend.app:app --host 127.0.0.1 --port 8765
