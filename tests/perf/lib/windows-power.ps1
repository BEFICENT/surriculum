$ErrorActionPreference = 'SilentlyContinue'

$computer = Get-CimInstance -ClassName Win32_ComputerSystem
$processors = @(Get-CimInstance -ClassName Win32_Processor)
$videoControllers = @(Get-CimInstance -ClassName Win32_VideoController)
$batteries = @(Get-CimInstance -ClassName Win32_Battery)
$batteryStatus = @(Get-CimInstance -Namespace 'root\wmi' -ClassName BatteryStatus)
$activeSchemeText = (& powercfg.exe /getactivescheme 2>$null | Out-String).Trim()
$processorPolicyText = (& powercfg.exe /query SCHEME_CURRENT SUB_PROCESSOR 2>$null | Out-String).Trim()
$schemeGuid = $null
if ($activeSchemeText -match '([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})') {
    $schemeGuid = $Matches[1].ToLowerInvariant()
}

$hasBattery = ($batteries.Count -gt 0) -or ($batteryStatus.Count -gt 0)
$powerOnline = $false
if ($batteryStatus.Count -gt 0) {
    $powerOnline = @($batteryStatus | Where-Object { $_.PowerOnline }).Count -gt 0
} elseif ($batteries.Count -gt 0) {
    # Win32_Battery status 2 is commonly reported while on external power.
    $powerOnline = @($batteries | Where-Object { $_.BatteryStatus -eq 2 }).Count -gt 0
}
$source = if (-not $hasBattery) { 'desktop' } elseif ($powerOnline) { 'ac' } else { 'battery' }

$result = [ordered]@{
    source = $source
    capturedAt = (Get-Date).ToUniversalTime().ToString('o')
    activeScheme = [ordered]@{
        guid = $schemeGuid
        raw = $activeSchemeText
    }
    processorPolicy = [ordered]@{
        command = 'powercfg /query SCHEME_CURRENT SUB_PROCESSOR'
        raw = $processorPolicyText
    }
    computer = [ordered]@{
        manufacturer = $computer.Manufacturer
        model = $computer.Model
        totalPhysicalMemory = [int64]$computer.TotalPhysicalMemory
    }
    processors = @($processors | ForEach-Object {
        [ordered]@{
            name = $_.Name.Trim()
            physicalCores = [int]$_.NumberOfCores
            logicalProcessors = [int]$_.NumberOfLogicalProcessors
            currentClockMHz = [int]$_.CurrentClockSpeed
            maxClockMHz = [int]$_.MaxClockSpeed
            loadPercent = [int]$_.LoadPercentage
        }
    })
    gpus = @($videoControllers | ForEach-Object {
        [ordered]@{
            name = $_.Name
            driverVersion = $_.DriverVersion
            adapterRam = if ($null -eq $_.AdapterRAM) { $null } else { [uint64]([uint32]$_.AdapterRAM) }
            currentHorizontalResolution = $_.CurrentHorizontalResolution
            currentVerticalResolution = $_.CurrentVerticalResolution
            currentRefreshRate = $_.CurrentRefreshRate
        }
    })
    batteries = @($batteries | ForEach-Object {
        [ordered]@{
            name = $_.Name
            status = $_.Status
            batteryStatus = $_.BatteryStatus
            estimatedChargeRemaining = $_.EstimatedChargeRemaining
            estimatedRunTimeMinutes = $_.EstimatedRunTime
        }
    })
    batteryStatus = @($batteryStatus | ForEach-Object {
        [ordered]@{
            instanceName = $_.InstanceName
            powerOnline = [bool]$_.PowerOnline
            charging = [bool]$_.Charging
            discharging = [bool]$_.Discharging
            remainingCapacity = $_.RemainingCapacity
            dischargeRate = $_.DischargeRate
            chargeRate = $_.ChargeRate
            voltage = $_.Voltage
        }
    })
}

$result | ConvertTo-Json -Depth 7 -Compress
