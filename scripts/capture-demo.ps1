# Windows desktop only. Installs the current checkout to the normal user location,
# starts actual console sessions, captures only their windows, then stops them.
# The server screenshot uses a real React/Vite app and may install demo dependencies.
[CmdletBinding()]
param([switch]$KeepServer)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$output = Join-Path $repo 'docs\screenshots'
$temp = Join-Path $repo '.artifacts\capture'
New-Item -ItemType Directory -Path $output, $temp -Force | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RunCapture {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][RunCapture]::SetProcessDPIAware()

function Capture-Window([IntPtr]$Window, [string]$Filename) {
    Start-Sleep -Seconds 1
    $rect = [RunCapture+Rect]::new()
    if (-not [RunCapture]::GetWindowRect($Window, [ref]$rect)) { throw 'Target console window is no longer available.' }
    $bitmap = [Drawing.Bitmap]::new($rect.Right - $rect.Left, $rect.Bottom - $rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        # Capture only the target window, even if another application covers it.
        # Never use CopyFromScreen: that could include unrelated desktop content.
        $hdc = $graphics.GetHdc()
        try { $ok = [RunCapture]::PrintWindow($Window, $hdc, 2) } finally { $graphics.ReleaseHdc($hdc) }
        if (-not $ok) { throw 'Windows could not capture the target console.' }
        $bitmap.Save($Filename, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    Write-Host "Captured $Filename"
}

$source = Join-Path $temp 'run-main'
if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Recurse -Force }
New-Item -ItemType Directory -Path $source | Out-Null
foreach ($item in @('bin', 'src', 'package.json', 'README.md', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $repo $item) -Destination $source -Recurse
}
$archive = Join-Path $temp 'run.zip'
Compress-Archive -LiteralPath $source -DestinationPath $archive -Force
$serverProcess = $null

foreach ($mode in @('Install', 'DryRun', 'Server')) {
    $ready = Join-Path $temp "$mode.ready"
    Remove-Item -LiteralPath $ready, ($ready + '.error'), ($ready + '.window') -Force -ErrorAction SilentlyContinue
    $session = Join-Path $PSScriptRoot 'demo-session.ps1'
    $arguments = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$session`" -Mode $mode -Archive `"$archive`" -ReadyFile `"$ready`""
    $process = Start-Process -FilePath "$env:WINDIR\System32\conhost.exe" -ArgumentList $arguments -PassThru
    try {
        $deadline = [DateTime]::Now.AddMinutes(3)
        while (-not (Test-Path -LiteralPath $ready)) {
            if (Test-Path -LiteralPath ($ready + '.error')) { throw (Get-Content -LiteralPath ($ready + '.error') -Raw) }
            if ([DateTime]::Now -gt $deadline) { throw "Timed out waiting for $mode session." }
            Start-Sleep -Milliseconds 300
        }
        if ($mode -eq 'Server') {
            $available = $false
            while ([DateTime]::Now -lt $deadline) {
                if (Test-Path -LiteralPath ($ready + '.error')) { throw (Get-Content -LiteralPath ($ready + '.error') -Raw) }
                try {
                    $response = Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:5173' -TimeoutSec 2
                    if ($response.StatusCode -eq 200 -and $response.Content -match 'React \+ Vite demo') { $available = $true; break }
                } catch { }
                Start-Sleep -Milliseconds 500
            }
            if (-not $available) { throw 'The React/Vite demo did not become available.' }
            Write-Host 'Verified: actual Vite server returned HTTP 200.'
        }
        $window = [IntPtr]([long](Get-Content -LiteralPath ($ready + '.window')))
        if ($window -eq [IntPtr]::Zero) { throw "Cannot find $mode console window." }
        $filename = switch ($mode) { 'Install' { '01-install.png' }; 'DryRun' { '02-dry-run.png' }; 'Server' { '03-react-vite.png' } }
        Capture-Window $window (Join-Path $output $filename)
        if ($mode -eq 'Server' -and $KeepServer) { $serverProcess = $process; continue }
    } finally {
        if ($serverProcess -ne $process) {
            # Stop only this capture's console/session tree, including the dev server.
            if (Test-Path -LiteralPath $ready) {
                $sessionPid = (Get-Content -LiteralPath $ready).Trim()
                & taskkill.exe /PID $sessionPid /T /F 2>$null | Out-Null
            }
            if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
        }
    }
}
if ($serverProcess) {
    Write-Host "Server left running for browser verification. Session PID: $(Get-Content -LiteralPath (Join-Path $temp 'Server.ready'))"
}
