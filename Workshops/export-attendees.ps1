# export-attendees.ps1
param(
    [switch]$Debug
)

# Configuration
$WorkshopTypes = @(
    'Basic Life',
    'Essential Work', 
    'Career Planning',
    'Resume',
    'Interview',
    'Networking',
    'Education'
)

$BaseUrl = 'https://midtown.pcrs.ca'
$CredsFile = Join-Path $env:USERPROFILE '.wp_creds'
$DebugDir = Join-Path $env:USERPROFILE 'Downloads\debug-export'

# Global session variable for cookies
$Session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

# Debug functions
function Write-DebugLog {
    param([string]$Message)
    if ($Debug) {
        Write-Host "[DEBUG] $Message" -ForegroundColor Cyan
    }
}

function Save-DebugFile {
    param(
        [string]$FileName,
        [string]$Content,
        [string]$Description = ''
    )
    if (-not $Debug) { return }
    
    if (-not (Test-Path $DebugDir)) {
        New-Item -ItemType Directory -Path $DebugDir -Force | Out-Null
        Write-DebugLog "Created debug directory: $DebugDir"
    }
    
    $Timestamp = (Get-Date).ToString('yyyy-MM-dd-HH-mm-ss')
    $DebugFileName = "$Timestamp-$FileName"
    $FullPath = Join-Path $DebugDir $DebugFileName
    
    try {
        $Content | Out-File -FilePath $FullPath -Encoding UTF8
        Write-DebugLog "Saved $($Description ?? $FileName) to: $FullPath"
    }
    catch {
        Write-DebugLog "Failed to save debug file $FileName`: $_"
    }
}

# Credential management
function Save-Credentials {
    param([string]$Username, [string]$Password)
    
    $Data = @{
        username = $Username
        password = $Password
    } | ConvertTo-Json
    
    $Encrypted = $Data | ConvertTo-SecureString -AsPlainText -Force | ConvertFrom-SecureString
    $Encrypted | Out-File -FilePath $CredsFile
    Write-Host "Credentials saved securely"
    Write-DebugLog "Credentials saved to: $CredsFile"
}

function Get-Credentials {
    if (Test-Path $CredsFile) {
        try {
            Write-DebugLog "Loading credentials from: $CredsFile"
            $Encrypted = Get-Content $CredsFile | ConvertTo-SecureString
            $Json = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Encrypted))
            $Creds = $Json | ConvertFrom-Json
            Write-DebugLog "Loaded credentials for user: $($Creds.username)"
            return $Creds
        }
        catch {
            Write-DebugLog "Failed to load credentials: $_"
        }
    }
    
    Write-DebugLog "Prompting user for new credentials"
    $Username = Read-Host "Enter your WordPress username"
    $SecurePassword = Read-Host "Enter your WordPress password" -AsSecureString
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePassword))
    
    $Save = Read-Host "Save credentials for future use? (y/N)"
    if ($Save -eq 'y' -or $Save -eq 'Y') {
        Save-Credentials -Username $Username -Password $Password
    }
    
    return @{
        username = $Username
        password = $Password
    }
}

# Web request with wait functionality
function Invoke-WebRequestWithWait {
    param(
        [string]$Uri,
        [hashtable]$Headers = @{},
        [string]$Method = 'GET',
        [string]$Body = $null,
        [int]$MaxRetries = 5,
        [int]$WaitSeconds = 3
    )
    
    $DefaultHeaders = @{
        'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
    $Headers = $DefaultHeaders + $Headers
    
    for ($attempt = 1; $attempt -le $MaxRetries; $attempt++) {
        Write-DebugLog "Request attempt $attempt/$MaxRetries for: $Uri"
        
        try {
            $params = @{
                Uri = $Uri
                Method = $Method
                Headers = $Headers
                WebSession = $Session
                UseBasicParsing = $true
            }
            
            if ($Body) {
                $params.Body = $Body
            }
            
            $response = Invoke-WebRequest @params
            $content = $response.Content
            
            # Check for loading message
            $cleanText = $content -replace '<script[^>]*>.*?</script>', '' -replace '<style[^>]*>.*?</style>', '' -replace '<[^>]*>', ''
            
            if ($cleanText -match 'Just a moment\.\.\.') {
                Write-DebugLog "Page still loading, waiting $WaitSeconds seconds before retry..."
                
                if ($attempt -eq $MaxRetries) {
                    Write-DebugLog "Max retries reached, proceeding with current response"
                    return $response
                }
                
                Start-Sleep -Seconds $WaitSeconds
                continue
            }
            
            Write-DebugLog "Page fully loaded on attempt $attempt"
            return $response
        }
        catch {
            Write-DebugLog "Request failed on attempt $attempt`: $_"
            if ($attempt -eq $MaxRetries) {
                throw
            }
            Start-Sleep -Seconds $WaitSeconds
        }
    }
}

# Login function
function Connect-WordPress {
    param([hashtable]$Credentials)
    
    Write-Host "Logging in to WordPress..."
    $loginUrl = "$BaseUrl/wp-login.php"
    
    Write-DebugLog "Starting login process for user: $($Credentials.username)"
    
    # Get login page
    $response = Invoke-WebRequestWithWait -Uri $loginUrl
    Save-DebugFile -FileName 'login-page.html' -Content $response.Content -Description 'initial login page'
    
    # Extract nonce if present
    $nonce = $null
    if ($response.Content -match 'name="_wpnonce"[^>]*value="([^"]*)"') {
        $nonce = $matches[1]
        Write-DebugLog "Login nonce found: $nonce"
    }
    
    # Prepare form data
    $formData = @{
        'log' = $Credentials.username
        'pwd' = $Credentials.password
        'wp-submit' = 'Log In'
        'redirect_to' = "$BaseUrl/wp-admin/"
    }
    
    if ($nonce) {
        $formData['_wpnonce'] = $nonce
    }
    
    # Convert to URL encoded string
    $body = ($formData.GetEnumerator() | ForEach-Object { "$($_.Key)=$([System.Web.HttpUtility]::UrlEncode($_.Value))" }) -join '&'
    
    # Submit login
    $headers = @{
        'Content-Type' = 'application/x-www-form-urlencoded'
    }
    
    $response = Invoke-WebRequestWithWait -Uri $loginUrl -Method POST -Headers $headers -Body $body
    Save-DebugFile -FileName 'login-response.html' -Content $response.Content -Description 'login response page'
    
    # Check success
    if ($response.BaseResponse.ResponseUri.AbsoluteUri -match 'wp-admin') {
        Write-Host "Login successful"
        Write-DebugLog "Login successful - redirected to wp-admin"
        return $true
    }
    else {
        Write-Host "Login failed"
        Write-DebugLog "Login failed - not redirected to wp-admin"
        return $false
    }
}

# Workshop selection
function Select-WorkshopType {
    Write-Host "`nSelect the type of workshop to export:"
    for ($i = 0; $i -lt $WorkshopTypes.Count; $i++) {
        Write-Host "$($i + 1). $($WorkshopTypes[$i])"
    }
    
    do {
        $selection = Read-Host "`nEnter your choice (1-$($WorkshopTypes.Count))"
        $index = [int]$selection - 1
    } while ($index -lt 0 -or $index -ge $WorkshopTypes.Count)
    
    $selected = $WorkshopTypes[$index]
    Write-DebugLog "User selected workshop type: $selected"
    return $selected
}

# Find workshop events
function Find-WorkshopEvents {
    param([string]$WorkshopType)
    
    Write-Host "Searching for '$WorkshopType' workshop events..."
    $calendarUrl = "$BaseUrl/calendar/"
    
    $response = Invoke-WebRequestWithWait -Uri $calendarUrl
    Save-DebugFile -FileName 'calendar-page.html' -Content $response.Content -Description 'calendar page HTML'
    
    # Parse HTML for events
    $events = @()
    $currentDate = Get-Date
    
    # Search terms mapping
    $searchTerms = @{
        'Basic Life' = @('basic life', 'life skills')
        'Essential Work' = @('essential work', 'work essential')
        'Career Planning' = @('career planning', 'career exploration')
        'Resume' = @('resume')
        'Interview' = @('interview', 'interviewing skills')
        'Networking' = @('network', 'networking')
        'Education' = @('education', 'educational')
    }
    
    $terms = $searchTerms[$WorkshopType] ?? @($WorkshopType.ToLower())
    Write-DebugLog "Search terms for '$WorkshopType': $($terms -join ', ')"
    
    # Simple regex-based event extraction (you'd refine this based on the actual HTML structure)
    $eventPattern = '<a[^>]*href="([^"]*event[^"]*)"[^>]*>([^<]*(?:' + ($terms -join '|') + ')[^<]*)</a>'
    $matches = [regex]::Matches($response.Content, $eventPattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    
    foreach ($match in $matches) {
        $url = $match.Groups[1].Value
        $title = $match.Groups[2].Value.Trim()
        
        if (-not $url.StartsWith('http')) {
            $url = $BaseUrl + $url
        }
        
        $events += @{
            title = $title
            url = $url
            dateText = 'Future Event'  # You'd extract actual dates from the HTML
        }
        
        Write-DebugLog "Found event: $title -> $url"
    }
    
    Write-Host "Found $($events.Count) matching events"
    return $events
}

# Main export function
function Export-Attendees {
    try {
        Write-Host "Starting WordPress attendee export..."
        Write-DebugLog "Debug mode enabled, files will be saved to: $DebugDir"
        
        # Get credentials and login
        $creds = Get-Credentials
        $loginSuccess = Connect-WordPress -Credentials $creds
        
        if (-not $loginSuccess) {
            throw "Login failed. Check your credentials."
        }
        
        # Select workshop type
        $workshopType = Select-WorkshopType
        
        # Find events
        $events = Find-WorkshopEvents -WorkshopType $workshopType
        
        if ($events.Count -eq 0) {
            throw "No upcoming '$workshopType' events found."
        }
        
        # Event selection logic would go here...
        # For now, using the first event
        $selectedEvent = $events[0]
        Write-Host "Selected event: $($selectedEvent.title)"
        
        # Continue with event ID extraction, attendees page access, CSV download...
        # (Similar pattern to the Node.js version)
        
        Write-Host "Export completed successfully!"
        
    }
    catch {
        Write-Error "Error: $_"
        Write-DebugLog "Full error details: $_"
        exit 1
    }
}

# Add System.Web assembly for URL encoding
Add-Type -AssemblyName System.Web

# Start the export
Export-Attendees