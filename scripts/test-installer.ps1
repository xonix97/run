# Offline by default. -TestPortableNode also tests the real nodejs.org download.
# No persistent PATH changes are made.
param([switch]$TestPortableNode)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$installer = Join-Path $repo 'install.ps1'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('run-installer-test-' + [guid]::NewGuid().ToString('N'))
$destination = Join-Path $temp 'path with spaces\run'
$userPathBefore = [Environment]::GetEnvironmentVariable('Path', 'User')
$processPathBefore = $env:Path

function Assert([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAILED: $Message" }
    Write-Host "PASS: $Message" -ForegroundColor Green
}

try {
    $source = Join-Path $temp 'source\run-main'
    New-Item -ItemType Directory -Path $source -Force | Out-Null
    foreach ($item in @('package.json', 'bin', 'src', 'README.md', 'LICENSE')) {
        Copy-Item -LiteralPath (Join-Path $repo $item) -Destination $source -Recurse
    }
    $archive = Join-Path $temp 'run.zip'
    Compress-Archive -LiteralPath $source -DestinationPath $archive
    & $installer -ArchivePath $archive -InstallDir $destination -NoPathUpdate -SkipNodeInstall
    $launcher = Join-Path $destination 'bin\run.cmd'
    $version = & $launcher --version
    Assert ($LASTEXITCODE -eq 0 -and "$version" -eq '0.1.0') 'Installed shim runs from a path with spaces'
    Assert (([Environment]::GetEnvironmentVariable('Path', 'User')) -ceq $userPathBefore) '-NoPathUpdate leaves user PATH unchanged'
    Assert ($env:Path -ceq $processPathBefore) '-NoPathUpdate leaves process PATH unchanged'

    $help = & $launcher --help
    Assert ($LASTEXITCODE -eq 0 -and "$help" -match 'Usage:') 'Installed CLI prints help'

    # Repeat installation to validate ownership marker and replacement/cleanup.
    & $installer -ArchivePath $archive -InstallDir $destination -NoPathUpdate -SkipNodeInstall
    $version = & $launcher --version
    Assert ($LASTEXITCODE -eq 0 -and "$version" -eq '0.1.0') 'Reinstall replaces the app successfully'
    $leftovers = @(Get-ChildItem -LiteralPath (Split-Path -Parent $destination) -Force | Where-Object { $_.Name -match '^\.run-(stage|backup)-' })
    Assert ($leftovers.Count -eq 0) 'No staging or backup directories remain'

    # Match the IWR/iex execution mode without network or global PATH changes.
    $invokeScript = Join-Path $temp 'test-iex.ps1'
    @'
param($Installer, $Archive, $Destination)
$ErrorActionPreference = 'Stop'
$content = Get-Content -LiteralPath $Installer -Raw
# Set defaults inside this test copy, exactly as the downloaded script would.
$content = $content.Replace("[string]`$ArchivePath,", "[string]`$ArchivePath = '$($Archive.Replace("'", "''"))',")
$content = $content.Replace("[string]`$InstallDir = (Join-Path `$env:LOCALAPPDATA 'Programs\run'),", "[string]`$InstallDir = '$($Destination.Replace("'", "''"))',")
$content = $content.Replace('[switch]$NoPathUpdate,', '[switch]$NoPathUpdate = $true,')
$content | Invoke-Expression
& (Join-Path $Destination 'bin\run.cmd') --version
if ($LASTEXITCODE -ne 0) { throw 'iex install failed' }
'@ | Set-Content -LiteralPath $invokeScript -Encoding UTF8
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $invokeScript $installer $archive (Join-Path $temp 'iex-install')
    Assert ($LASTEXITCODE -eq 0) 'Installer runs via Invoke-Expression'

    $unrelated = Join-Path $temp 'unrelated'
    New-Item -ItemType Directory -Path $unrelated | Out-Null
    Set-Content -LiteralPath (Join-Path $unrelated 'keep.txt') -Value 'do not overwrite'
    $refused = $false
    try { & $installer -ArchivePath $archive -InstallDir $unrelated -NoPathUpdate -SkipNodeInstall } catch { $refused = $_.Exception.Message -match 'Refusing to overwrite' }
    Assert $refused 'Refuses to overwrite an unrelated non-empty directory'
    Assert ((Get-Content -LiteralPath (Join-Path $unrelated 'keep.txt')) -eq 'do not overwrite') 'Unrelated files preserved'

    # A broken update must not destroy a working installation.
    Remove-Item -LiteralPath (Join-Path $source 'bin\run.js')
    $badArchive = Join-Path $temp 'broken.zip'
    Compress-Archive -LiteralPath $source -DestinationPath $badArchive
    $rejected = $false
    try { & $installer -ArchivePath $badArchive -InstallDir $destination -NoPathUpdate -SkipNodeInstall } catch { $rejected = $true }
    Assert $rejected 'Rejects an invalid archive'
    $version = & $launcher --version
    Assert ($LASTEXITCODE -eq 0 -and "$version" -eq '0.1.0') 'Existing installation survives a failed update'
    if ($TestPortableNode) {
        $portable = Join-Path $temp 'portable-node'
        try {
            # Hide any existing Node installation to exercise first-time bootstrap.
            $env:Path = "$env:WINDIR\System32;$env:WINDIR\System32\WindowsPowerShell\v1.0"
            & $installer -ArchivePath $archive -InstallDir $portable -NoPathUpdate
            Assert (Test-Path -LiteralPath (Join-Path $portable 'runtime\node.exe')) 'Portable Node.js downloaded and checksum verified'
            $version = & (Join-Path $portable 'bin\run.cmd') --version
            Assert ($LASTEXITCODE -eq 0 -and "$version" -eq '0.1.0') 'CLI works without a system Node installation'
            $npmVersion = & (Join-Path $portable 'runtime\npm.cmd') --version
            Assert ($LASTEXITCODE -eq 0 -and "$npmVersion" -match '^\d+\.') 'Portable runtime includes a working npm'
        } finally { $env:Path = $processPathBefore }
    }
    Write-Host "`nAll installer checks passed." -ForegroundColor Green
} finally {
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
