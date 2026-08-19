# JWC sistemindeki 3 servisi (merkez, adapha-api, Expo) portlarina gore bulup kapatir.

$portlar = @(8100, 3000, 8081)

foreach ($port in $portlar) {
    $baglantilar = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if (-not $baglantilar) {
        Write-Host "Port ${port}: calisan servis yok." -ForegroundColor DarkGray
        continue
    }
    $pidler = $baglantilar | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($ownerPid in $pidler) {
        try {
            $islem = Get-Process -Id $ownerPid -ErrorAction Stop
            Stop-Process -Id $ownerPid -Force -Confirm:$false
            Write-Host "Port ${port}: $($islem.ProcessName) (PID $ownerPid) kapatildi." -ForegroundColor Yellow
        } catch {
            Write-Host "Port ${port}: PID $ownerPid kapatilamadi." -ForegroundColor Red
        }
    }
}

Write-Host ""
Write-Host "Durduruldu." -ForegroundColor Green
