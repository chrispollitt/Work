<#
.SYNOPSIS
    Script to export and process attendee lists from WP Events Calendar.
    
.DESCRIPTION
    This script calls the Node.js export-attendees.js script, waits for completion,
    finds the downloaded CSV, and processes it by reformatting columns, names, and phone numbers.

.EXAMPLE
    powershell -File attendee_list.ps1
#>

param(
    [string]$OutputPath = "$env:USERPROFILE\Downloads\processed-attendees-$(Get-Date -Format 'yyyy-MM-dd').csv"
)

function Write-Log {
    param (
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [$Level] $Message"
}

function Source-Bat {
    param([string]$batPath)
    
    if (Test-Path $batPath) {
        Write-Log "Sourcing batch file: $batPath"
        cmd /c "`"$batPath`" && set" | ForEach-Object {
            if ($_ -match "^(.+?)=(.*)$") {
                Set-Item "env:\$($matches[1])" $matches[2]
            }
        }
    } else {
        Write-Log "Batch file not found: $batPath" -Level "WARNING"
    }
}

function Wait-ForFileDownload {
    param(
        [string]$DownloadFolder,
        [string]$FilePattern,
        [int]$TimeoutSeconds = 300
    )
    
    Write-Log "Waiting for file matching pattern '$FilePattern' in '$DownloadFolder'..."
    
    $startTime = Get-Date
    do {
        $files = Get-ChildItem -Path $DownloadFolder -Filter $FilePattern | Sort-Object LastWriteTime -Descending
        
        if ($files.Count -gt 0) {
            # Return the most recent file
            return $files[0].FullName
        }
        
        Start-Sleep -Seconds 2
        $elapsed = (Get-Date) - $startTime
        
    } while ($elapsed.TotalSeconds -lt $TimeoutSeconds)
    
    throw "Timeout waiting for file download after $TimeoutSeconds seconds"
}

function Format-PhoneNumber {
    param (
        [string]$Phone
    )
    
    if ([string]::IsNullOrWhiteSpace($Phone)) {
        return ""
    }
    
    # Remove all non-digit characters
    $digits = $Phone -replace '[^\d]', ''
    
    # Check if we have a valid number of digits for a phone number (10 for US/Canada)
    if ($digits.Length -eq 10) {
        return "$($digits.Substring(0,3))-$($digits.Substring(3,3))-$($digits.Substring(6,4))"
    }
    elseif ($digits.Length -eq 11 -and $digits.StartsWith("1")) {
        # Handle numbers with country code 1
        return "$($digits.Substring(1,3))-$($digits.Substring(4,3))-$($digits.Substring(7,4))"
    }
    else {
        # If the format is unexpected, return the original but with dashes
        if ($digits.Length -ge 10) {
            return "$($digits.Substring(0,3))-$($digits.Substring(3,3))-$($digits.Substring(6))"
        }
        return $digits
    }
}

function Format-PersonName {
    param (
        [string]$Name
    )
    
    if ([string]::IsNullOrWhiteSpace($Name)) {
        return ""
    }
    
    # Check if the name is in "Last, First" format by seeing if it contains a comma
    if ($Name -match "^([^,]+),\s*(.+)$") {
        $lastName = $matches[1].Trim()
        $firstName = $matches[2].Trim()
        return "$firstName $lastName"
    }
    else {
        # If the name is not in the expected format, return it as is
        return $Name.Trim()
    }
}

# MAIN ##########################################
try {
    Write-Log "Starting attendee list export and processing..."
    
    # Step 1: Setup Node.js environment if batch file exists
    $nodeVarsBat = "c:/Users/cpollitt/OneDrive-PCRS/dev/node/nodevars.bat"
    if (Test-Path $nodeVarsBat) {
        Source-Bat $nodeVarsBat
    }
    
    # Step 2: Call export-attendees.js and wait for completion
    Write-Log "Calling export-attendees.js..."
    $nodeProcess = Start-Process "node" -ArgumentList "export-attendees.js" -Wait -PassThru -NoNewWindow
    
    if ($nodeProcess.ExitCode -ne 0) {
        throw "Node.js script failed with exit code: $($nodeProcess.ExitCode)"
    }
    
    Write-Log "Node.js script completed successfully"
    
    # Step 3: Find the downloaded CSV file
    $downloadFolder = "$env:USERPROFILE\Downloads"
    $csvPattern = "*attendees*.csv"
    
    $csvPath = Wait-ForFileDownload -DownloadFolder $downloadFolder -FilePattern $csvPattern
    Write-Log "Found downloaded CSV: $csvPath"
    
    # Step 4: Process the CSV file
    Write-Log "Processing CSV file..."
    
    if (-not (Test-Path $csvPath)) {
        Write-Log "CSV file not found at expected path: $csvPath" -Level "ERROR"
        throw "CSV file not found at expected path: $csvPath"
    }
    
    # Read the CSV data
    $attendees = Import-Csv -Path $csvPath
    
    if ($attendees.Count -eq 0) {
        Write-Log "No attendees found in CSV file" -Level "WARNING"
        return
    }
    
    Write-Log "Processing $($attendees.Count) attendee records..."
    
    # Create new custom objects with desired properties
    $processedAttendees = $attendees | ForEach-Object {
        $name = Format-PersonName -Name $_.'Ticket Holder Name'
        $phone = Format-PhoneNumber -Phone $_.'Phone Number'
        
        # Create a new object with the desired properties
        [PSCustomObject]@{
            Name = $name
            Phone = $phone
            Email = $_.'Ticket Holder Email Address'
            ES = $_.'Who is your Employment Specialist?'
            'Case #' = $_.'ICM Number'
        }
    }
    
    # Sort by name
    $processedAttendees = $processedAttendees | Sort-Object -Property Name
    
    # Export to the specified output path
    $processedAttendees | Export-Csv -Path $OutputPath -NoTypeInformation
    
    Write-Log "Processing complete. Processed file saved to: $OutputPath"
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Green
    Write-Host "SUCCESS: Attendee list has been processed!" -ForegroundColor Green
    Write-Host "The processed file has been saved to:" -ForegroundColor Green
    Write-Host $OutputPath -ForegroundColor Yellow
    Write-Host "Total attendees processed: $($processedAttendees.Count)" -ForegroundColor Green
    Write-Host "==================================================" -ForegroundColor Green
    
    # Open the processed file in Excel
    if (Get-Command "excel.exe" -ErrorAction SilentlyContinue) {
        Start-Process "excel.exe" -ArgumentList $OutputPath
    } else {
        Write-Log "Excel not found, opening with default CSV handler"
        Start-Process $OutputPath
    }
}
catch {
    Write-Log "Error processing attendee list: $_" -Level "ERROR"
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Red
    Write-Host "ERROR: Failed to process attendee list" -ForegroundColor Red
    Write-Host "Error details: $_" -ForegroundColor Red
    Write-Host "==================================================" -ForegroundColor Red
    
    exit 1
}