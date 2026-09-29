# Install run from https://github.com/xonix97/run (Windows PowerShell 5.1+).
# Review this file before executing a downloaded copy.
[CmdletBinding()]
param(
    [string]$Version = 'main',
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\run'),
    [string]$ArchivePath,
    [switch]$NoPathUpdate,
    [switch]$SkipNodeInstall
)

# Keep preferences and helper functions local, including when piped into iex.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    Set-StrictMode -Version 2.0

    if ($env:OS -ne 'Windows_NT') { throw 'This installer is for Windows. See the README for GitHub/npm installation on macOS and Linux.' }
    if ($PSVersionTable.PSVersion.Major -lt 5) { throw 'PowerShell 5.1 or newer is required.' }

    function Write-Step([string]$Message) { Write-Host "  $Message" -ForegroundColor Cyan }
    function Get-NodeMajor([string]$Executable) {
        try {
            $value = & $Executable --version 2>$null
            if ($LASTEXITCODE -eq 0 -and "$value" -match '^v(\d+)\.') { return [int]$Matches[1] }
        } catch { }
        return 0
    }
    function Add-PathEntry([string]$Current, [string]$Entry) {
        $parts = @($Current -split ';' | Where-Object {
            $_ -and $_.Trim().TrimEnd('\') -ine $Entry.TrimEnd('\')
        })
        return (@($Entry) + $parts) -join ';'
    }
    function Download([string]$Url, [string]$Destination) {
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -TimeoutSec 180
    }

    $destination = [IO.Path]::GetFullPath($InstallDir)
    if ($destination -match '[%"\r\n]') { throw 'InstallDir cannot contain %, quotes, or newlines.' }
    $markerPath = Join-Path $destination '.run-install.json'
    if (Test-Path -LiteralPath $destination) {
        if (-not (Test-Path -LiteralPath $destination -PathType Container)) { throw 'InstallDir must be a directory.' }
        if (Test-Path -LiteralPath $markerPath) {
            $previous = Get-Content -LiteralPath $markerPath -Raw | ConvertFrom-Json
            if ($previous.repository -ne 'xonix97/run') { throw 'InstallDir belongs to another application.' }
        } elseif (@(Get-ChildItem -LiteralPath $destination -Force).Count -gt 0) {
            throw "Refusing to overwrite a non-empty directory not owned by run: $destination"
        }
    }

    $oldTls = [Net.ServicePointManager]::SecurityProtocol
    [Net.ServicePointManager]::SecurityProtocol = $oldTls -bor [Net.SecurityProtocolType]::Tls12
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('run-install-' + [guid]::NewGuid().ToString('N'))
    $stage = $null
    $backup = $null
    $committed = $false
    $userPathBefore = $null
    $pathWritten = $false
    $processPathBefore = $env:Path
    $destinationExisted = Test-Path -LiteralPath $destination

    try {
        Write-Host ''
        Write-Host 'RUN installer' -ForegroundColor Green
        Write-Host '------------------------------------' -ForegroundColor DarkGray
        Write-Host 'Source: github.com/xonix97/run'
        Write-Host "Target: $destination"
        Write-Host ''

        New-Item -ItemType Directory -Path $scratch -Force | Out-Null
        $archive = Join-Path $scratch 'run.zip'
        if ($ArchivePath) {
            Write-Step 'Reading local archive...'
            Copy-Item -LiteralPath $ArchivePath -Destination $archive
        } else {
            Write-Step "Downloading run ($Version) from GitHub..."
            $ref = [Uri]::EscapeDataString($Version)
            Download "https://codeload.github.com/xonix97/run/zip/$ref" $archive
        }
        $extracted = Join-Path $scratch 'extracted'
        Expand-Archive -LiteralPath $archive -DestinationPath $extracted
        $roots = @(Get-ChildItem -LiteralPath $extracted -Directory | Where-Object {
            Test-Path -LiteralPath (Join-Path $_.FullName 'package.json')
        })
        if ($roots.Count -ne 1) { throw 'The archive must contain one project root with package.json.' }
        $source = $roots[0].FullName
        $package = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
        if ($package.name -ne 'run-cli' -or $package.bin.run -ne 'bin/run.js' -or
            -not (Test-Path -LiteralPath (Join-Path $source 'bin\run.js')) -or
            -not (Test-Path -LiteralPath (Join-Path $source 'src\cli.js'))) {
            throw 'Archive is not a valid xonix97/run package.'
        }

        $parent = Split-Path -Parent $destination
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
        $stage = Join-Path $parent ('.run-stage-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path (Join-Path $stage 'app'), (Join-Path $stage 'bin') -Force | Out-Null
        foreach ($item in @('bin', 'src', 'package.json', 'README.md', 'LICENSE')) {
            $from = Join-Path $source $item
            if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $stage 'app') -Recurse }
        }

        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $node = $null
        if ($nodeCommand -and (Get-NodeMajor $nodeCommand.Source) -ge 18) {
            $node = $nodeCommand.Source
            Write-Step "Using Node.js $(& $node --version)"
        } elseif ((Test-Path -LiteralPath (Join-Path $destination 'runtime\node.exe')) -and
                  (Get-NodeMajor (Join-Path $destination 'runtime\node.exe')) -ge 18) {
            Copy-Item -LiteralPath (Join-Path $destination 'runtime') -Destination $stage -Recurse
            $node = Join-Path $stage 'runtime\node.exe'
            Write-Step "Using bundled Node.js $(& $node --version)"
        } else {
            if ($SkipNodeInstall) { throw 'Node.js 18+ was not found. Install it from https://nodejs.org or omit -SkipNodeInstall.' }
            $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
            $nodeArch = switch ($architecture) { 'ARM64' { 'arm64' }; 'AMD64' { 'x64' }; 'x86' { 'x86' }; default { throw "Unsupported architecture: $architecture" } }
            Write-Step "Downloading portable Node.js LTS ($nodeArch) from nodejs.org..."
            $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 60
            $release = $releases | Where-Object { $_.lts -and $_.files -contains "win-$nodeArch-zip" } | Select-Object -First 1
            if (-not $release) { throw "No Node.js LTS Windows build is available for $nodeArch." }
            $nodeFolder = "node-$($release.version)-win-$nodeArch"
            $nodeFile = "$nodeFolder.zip"
            $nodeZip = Join-Path $scratch $nodeFile
            $checksums = Join-Path $scratch 'SHASUMS256.txt'
            Download "https://nodejs.org/dist/$($release.version)/$nodeFile" $nodeZip
            Download "https://nodejs.org/dist/$($release.version)/SHASUMS256.txt" $checksums
            $pattern = '^([a-fA-F0-9]{64})\s+\*?' + [regex]::Escape($nodeFile) + '$'
            $expectedHash = $null
            foreach ($line in Get-Content -LiteralPath $checksums) {
                if ($line -match $pattern) { $expectedHash = $Matches[1]; break }
            }
            if (-not $expectedHash -or (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash -ine $expectedHash) {
                throw 'Node.js archive checksum verification failed.'
            }
            Write-Step 'Node.js SHA256 checksum verified.'
            Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $scratch 'node')
            Move-Item -LiteralPath (Join-Path $scratch "node\$nodeFolder") -Destination (Join-Path $stage 'runtime')
            $node = Join-Path $stage 'runtime\node.exe'
            if ((Get-NodeMajor $node) -lt 18) { throw 'Downloaded Node.js could not be started.' }
        }

        # No PowerShell shim: run.cmd works even under Restricted execution policy.
        # The portable runtime includes npm and is made available to project commands.
        $launcher = @'
@echo off
setlocal
if exist "%~dp0..\runtime\node.exe" (
  set "PATH=%~dp0..\runtime;%PATH%"
  "%~dp0..\runtime\node.exe" "%~dp0..\app\bin\run.js" %*
) else (
  node "%~dp0..\app\bin\run.js" %*
)
exit /b %errorlevel%
'@
        [IO.File]::WriteAllText((Join-Path $stage 'bin\run.cmd'), ($launcher -replace '\r?\n', "`r`n") + "`r`n", [Text.Encoding]::ASCII)
        $metadata = @{ repository = 'xonix97/run'; version = $package.version; ref = $Version; installedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $stage '.run-install.json'), $metadata)
        $verification = & $node (Join-Path $stage 'app\bin\run.js') --version
        if ($LASTEXITCODE -ne 0 -or "$verification".Trim() -ne $package.version) { throw 'CLI verification failed; the previous installation has not been changed.' }

        Write-Step 'Installing CLI and command shim...'
        if ($destinationExisted) {
            $backup = Join-Path $parent ('.run-backup-' + [guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $destination -Destination $backup
        }
        Move-Item -LiteralPath $stage -Destination $destination
        $stage = $null
        $binPath = Join-Path $destination 'bin'
        if (-not $NoPathUpdate) {
            $userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
            $newUserPath = Add-PathEntry $userPathBefore $binPath
            if ($newUserPath -cne $userPathBefore) {
                [Environment]::SetEnvironmentVariable('Path', $newUserPath, 'User')
                $pathWritten = $true
            }
            $env:Path = Add-PathEntry $env:Path $binPath
            Write-Step 'Added run to your user PATH and this PowerShell session.'

            # Let Explorer/new terminal windows pick up the new user PATH.
            try {
                if (-not ('RunInstaller.EnvironmentBroadcast' -as [type])) {
                    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace RunInstaller {
    public static class EnvironmentBroadcast {
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
    }
}
'@
                }
                $broadcastResult = [UIntPtr]::Zero
                [void][RunInstaller.EnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 2000, [ref]$broadcastResult)
            } catch { Write-Warning 'PATH was saved. Restart your terminal if a new window does not pick it up.' }
        }
        $committed = $true
        Write-Host ''
        Write-Host "  Installed run $($package.version) successfully." -ForegroundColor Green
        if ($NoPathUpdate) {
            Write-Host "  PATH unchanged. Launcher: $binPath\run.cmd"
        } else {
            Write-Host '  Try: run --help'
            Write-Host '  Then cd into a project and type: run'
            Write-Host '  Existing terminal windows may need to be reopened.'
        }
        Write-Host ''
    } catch {
        # Restore the previous app and PATH if installation fails mid-update.
        if ($pathWritten) { [Environment]::SetEnvironmentVariable('Path', $userPathBefore, 'User') }
        $env:Path = $processPathBefore
        if ($backup -and (Test-Path -LiteralPath $backup)) {
            if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
            Move-Item -LiteralPath $backup -Destination $destination
            $backup = $null
        } elseif (-not $destinationExisted -and -not $stage -and (Test-Path -LiteralPath $destination)) {
            Remove-Item -LiteralPath $destination -Recurse -Force
        }
        throw "run installation failed: $($_.Exception.Message)"
    } finally {
        [Net.ServicePointManager]::SecurityProtocol = $oldTls
        if ($stage -and (Test-Path -LiteralPath $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
        if ($committed -and $backup -and (Test-Path -LiteralPath $backup)) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue }
    }
}
