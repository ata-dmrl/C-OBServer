# JWC sistemini tek komutla ayaga kaldirir.
# Sirayla 3 ayri pencere acar: merkez -> adapha-api -> Expo (Metro).
# Her biri kendi canli logunu gostermeye devam etsin diye ayri pencerelerde.

$kok = $PSScriptRoot

Write-Host "1/3 Merkez baslatiliyor (port 8100)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$kok\jwc\merkez'; .\.venv\Scripts\uvicorn.exe api:app --host 0.0.0.0 --port 8100"
)
Start-Sleep -Seconds 3

Write-Host "2/3 adapha-api baslatiliyor (port 3000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$kok\adapha-rn\adapha-api'; npm run dev"
)
Start-Sleep -Seconds 3

Write-Host "3/3 Expo baslatiliyor (port 8081)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "cd '$kok\adapha-rn\adapha-rn'; `$env:REACT_NATIVE_PACKAGER_HOSTNAME='192.168.1.187'; npx expo start --go"
)

Write-Host ""
Write-Host "Uc servis de baslatildi. Durdurmak icin: .\durdur.ps1" -ForegroundColor Green
