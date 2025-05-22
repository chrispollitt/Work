<#
.SYNOPSIS
    Script to export and process attendee lists from WP Events Calendar.
	SHould use Microsoft Edge DevTools Protocol in future version
    
.DESCRIPTION
    This script navigates to a specified WP Events Calendar event URL, accesses the Attendees page,
    exports the attendee list, and processes the CSV data by reformatting columns, names, and phone numbers.
    
.PARAMETER EventUrl
    The URL of the event page from which to export attendees.
    
.PARAMETER OutputPath
    Optional. Custom path where the processed CSV should be saved. If not specified, the file will be saved to the Desktop.
    
.EXAMPLE
    .\Export-EventAttendees.ps1 -EventUrl "https://midtown.pcrs.ca/event/career-planning-day-1-zoom-11/"
    
.EXAMPLE
    .\Export-EventAttendees.ps1 -EventUrl "https://midtown.pcrs.ca/event/career-planning-day-1-zoom-11/" -OutputPath "C:\Data\Processed-Attendees.csv"
#>

param (
    [Parameter(Mandatory = $true)]
    [string]$EventUrl,
    
    [Parameter(Mandatory = $false)]
    [string]$OutputPath = "$env:OneDriveCommercial\Desktop\Processed-Attendees.csv"
)

function Write-Log {
    param (
        [string]$Message,
        [string]$Level = "INFO"
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$timestamp] [$Level] $Message"
}

function Wait-ForFileDownload {
    param (
        [string]$DownloadFolder,
        [string]$FilePattern,
        [int]$TimeoutSeconds = 60
    )
    
    Write-Log "Waiting for file matching pattern '$FilePattern' to appear in $DownloadFolder..."
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    $fileFound = $false
    
    while ($stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        $files = Get-ChildItem -Path $DownloadFolder -Filter $FilePattern | Sort-Object LastWriteTime -Descending
        
        if ($files.Count -gt 0) {
            $newestFile = $files[0]
            $fileAge = (Get-Date) - $newestFile.LastWriteTime
            
            # Consider the file as "done downloading" if it's been created/modified within the last 10 seconds
            if ($fileAge.TotalSeconds -lt 10) {
                Write-Log "File is still being written, waiting for download to complete..."
                Start-Sleep -Seconds 2
                continue
            }
            
            Write-Log "Found downloaded file: $($newestFile.FullName)"
            return $newestFile.FullName
        }
        
        Start-Sleep -Seconds 1
    }
    
    Write-Log "Timeout waiting for download to complete" -Level "ERROR"
    throw "Timeout waiting for file matching '$FilePattern' to appear in $DownloadFolder"
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

try {
    # Check if Edge is installed (preferred for automation)
    $edgePath = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    $chromePath = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
    $browserPath = ""
    
    if (Test-Path $edgePath) {
        $browserPath = $edgePath
        Write-Log "Microsoft Edge detected, will use for automation."
    }
    elseif (Test-Path $chromePath) {
        $browserPath = $chromePath
        Write-Log "Google Chrome detected, will use for automation."
    }
    else {
        Write-Log "Neither Microsoft Edge nor Google Chrome found in standard locations. Using default system browser." -Level "WARNING"
    }
    
    # Step 1: Navigate to event URL
    Write-Log "Navigating to event URL: $EventUrl"
    
    if ($browserPath) {
        Start-Process $browserPath -ArgumentList $EventUrl
    }
    else {
        Start-Process $EventUrl
    }
    
    # Step 2: Prompt user to navigate to attendees page and export
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "MANUAL ACTION REQUIRED" -ForegroundColor Yellow
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "1. In the browser that just opened, click on the 'Attendees' link at the top"
    Write-Host "2. Click the 'Export' button to download the attendee list"
    Write-Host "3. Wait for the download to complete, then press Enter to continue"
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host ""
    $null = Read-Host "Press Enter once the export has been downloaded"
    
    # Step 3: Find the downloaded CSV file
    $downloadFolder = "$env:USERPROFILE\Downloads"
    $csvPattern = "*Career*Planning*Day*attendees*.csv"
    
    try {
        $csvPath = Wait-ForFileDownload -DownloadFolder $downloadFolder -FilePattern $csvPattern
        Write-Log "Found downloaded CSV: $csvPath"
    }
    catch {
        Write-Log "Error finding the downloaded CSV file: $_" -Level "ERROR"
        throw "Could not find the attendee CSV file in the Downloads folder. Please check if the file was downloaded correctly."
    }
    
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
    
    # Open Windows Explorer to the location of the processed file
    $folderPath = Split-Path -Parent $OutputPath
    Start-Process "explorer.exe" -ArgumentList $folderPath
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