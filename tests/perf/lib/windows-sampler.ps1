param(
    [int]$IntervalMs = 500,
    [string]$ProfileMarker = ''
)

$ErrorActionPreference = 'SilentlyContinue'
$IntervalMs = [Math]::Max(250, $IntervalMs)
$browserNames = @('brave', 'chrome', 'chromium', 'msedge')
$knownProcessIds = @()
$sampleIndex = 0
$batteries = @(Get-CimInstance Win32_Battery)
$batteryStatus = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStatus)

while ($true) {
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    if (($sampleIndex % 10) -eq 0 -or $knownProcessIds.Count -eq 0) {
        if ($ProfileMarker) {
            $knownProcessIds = @(Get-CimInstance Win32_Process | Where-Object {
                $browserNames -contains ([System.IO.Path]::GetFileNameWithoutExtension($_.Name)) -and
                $_.CommandLine -and $_.CommandLine.Contains($ProfileMarker)
            } | ForEach-Object { [int]$_.ProcessId })
        } else {
            $knownProcessIds = @(Get-Process -Name $browserNames | ForEach-Object { [int]$_.Id })
        }
    }

    $processes = @($knownProcessIds | ForEach-Object { Get-Process -Id $_ })
    # Battery CIM is comparatively expensive. Refresh it at 0.5 Hz while
    # retaining a roughly 2 Hz browser working-set sample.
    if ($sampleIndex -gt 0 -and ($sampleIndex % 4) -eq 0) {
        $batteries = @(Get-CimInstance Win32_Battery)
        $batteryStatus = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStatus)
    }
    $powerOnline = @($batteryStatus | Where-Object { $_.PowerOnline }).Count -gt 0
    $hasBattery = ($batteries.Count -gt 0) -or ($batteryStatus.Count -gt 0)
    $source = if (-not $hasBattery) { 'desktop' } elseif ($powerOnline) { 'ac' } else { 'battery' }
    $watch.Stop()

    $result = [ordered]@{
        capturedAt = (Get-Date).ToUniversalTime().ToString('o')
        source = $source
        sampleIndex = $sampleIndex
        collectionDurationMs = [Math]::Round($watch.Elapsed.TotalMilliseconds, 2)
        browserProcesses = [ordered]@{
            count = $processes.Count
            processIds = @($processes | ForEach-Object { $_.Id })
            workingSetBytes = [int64](($processes | Measure-Object WorkingSet64 -Sum).Sum)
            privateMemoryBytes = [int64](($processes | Measure-Object PrivateMemorySize64 -Sum).Sum)
            cumulativeCpuSeconds = [double](($processes | Measure-Object CPU -Sum).Sum)
        }
        battery = [ordered]@{
            chargePercent = if ($batteries.Count) { ($batteries | Select-Object -First 1).EstimatedChargeRemaining } else { $null }
            remainingCapacity = if ($batteryStatus.Count) { ($batteryStatus | Select-Object -First 1).RemainingCapacity } else { $null }
            dischargeRate = if ($batteryStatus.Count) { ($batteryStatus | Select-Object -First 1).DischargeRate } else { $null }
            chargeRate = if ($batteryStatus.Count) { ($batteryStatus | Select-Object -First 1).ChargeRate } else { $null }
            voltage = if ($batteryStatus.Count) { ($batteryStatus | Select-Object -First 1).Voltage } else { $null }
        }
    }
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
    [Console]::Out.Flush()
    $sampleIndex += 1
    $remaining = $IntervalMs - [int]$watch.ElapsedMilliseconds
    if ($remaining -gt 0) { Start-Sleep -Milliseconds $remaining }
}
