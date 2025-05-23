<#
.SYNOPSIS
    Script to export and process attendee lists from WP Events Calendar.
	SHould use Microsoft Edge DevTools Protocol in future version
    
.DESCRIPTION
    This script navigates to a specified WP Events Calendar event URL, accesses the Attendees page,
    exports the attendee list, and processes the CSV data by reformatting columns, names, and phone numbers.
    
#>


function Write-Log {
    param (
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [$Level] $Message"
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
    # Step 1: call nodevars.bat to setup env
	Source-Bat "c:/Users/cpollitt/OneDrive-PCRS/dev/node/nodevars.bat"
    
    # Step 2: call export-attendees.js
    Write-Log "Calling export-attendees.js"
    Start-Process "node" -ArgumentList "export-attendees.js"
    
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
    Write-Host "==================================================" -ForegroundColor Green
    
    # Open  the processed file
    Start-Process "excel.exe" -ArgumentList $OutputPath
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
