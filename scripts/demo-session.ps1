# Opened by capture-demo.ps1 in a real console window, never a rendered mockup.
param(
    [ValidateSet('Install', 'DryRun', 'Server')][string]$Mode,
    [string]$Archive,
    [string]$ReadyFile
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$env:NO_COLOR = '1'
$env:npm_config_update_notifier = 'false'
$env:npm_config_fund = 'false'
$env:npm_config_audit = 'false'
$env:npm_config_heading = 'npm'
$Host.UI.RawUI.WindowTitle = "run demo - $Mode"
$Host.UI.RawUI.BackgroundColor = 'Black'
$Host.UI.RawUI.ForegroundColor = 'Gray'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RunDemoConsole {
    [StructLayout(LayoutKind.Sequential)] public struct Coord { public short X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct Font {
        public uint cbSize, nFont; public Coord size; public uint family, weight;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string face;
    }
    [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
    [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int handle);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern bool SetCurrentConsoleFontEx(IntPtr handle, bool maximum, ref Font font);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
}
'@
$window = [RunDemoConsole]::GetConsoleWindow()
$font = [RunDemoConsole+Font]::new()
$font.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($font)
$fontSize = [RunDemoConsole+Coord]::new()
$fontSize.Y = 22
$font.size = $fontSize
$font.family = 54
$font.weight = 400
$font.face = 'Consolas'
[void][RunDemoConsole]::SetCurrentConsoleFontEx([RunDemoConsole]::GetStdHandle(-11), $false, [ref]$font)
[void][RunDemoConsole]::MoveWindow($window, 120, 100, 1220, 910, $true)
Start-Sleep -Milliseconds 300
Clear-Host
Set-Content -LiteralPath ($ReadyFile + '.window') -Value $window.ToInt64()

function Prompt-Command([string]$Text) {
    Write-Host "PS $(Get-Location)> " -ForegroundColor DarkGray -NoNewline
    Write-Host $Text -ForegroundColor White
}

try {
    if ($Mode -eq 'Install') {
        Set-Location $repo
        $env:RUN_DEMO_ARCHIVE = $Archive
        Prompt-Command '.\install.ps1 -ArchivePath $env:RUN_DEMO_ARCHIVE'
        & (Join-Path $repo 'install.ps1') -ArchivePath $Archive
        Prompt-Command 'run --version'
        run --version
        if ($LASTEXITCODE -ne 0) { throw 'Installed command failed.' }
        Prompt-Command '(Get-Command run).Source'
        (Get-Command run).Source
        Write-Host ''
        Write-Host 'Ready. Change into a project directory and type run.' -ForegroundColor Green
    } else {
        # This is a fresh process; read the persisted PATH rather than inheriting
        # the older parent terminal's PATH. Prepend only the installed run bin.
        $runBin = Join-Path $env:LOCALAPPDATA 'Programs\run\bin'
        $env:Path = "$runBin;$env:Path"
        Set-Location (Join-Path $repo 'examples\react-vite')
        if ($Mode -eq 'DryRun') {
            Prompt-Command 'run --dry-run'
            run --dry-run
            if ($LASTEXITCODE -ne 0) { throw 'Dry run failed.' }
            Write-Host ''
            Prompt-Command 'run --script preview --dry-run'
            run --script preview --dry-run
            if ($LASTEXITCODE -ne 0) { throw 'Preview dry run failed.' }
        } else {
            Prompt-Command 'run'
            Set-Content -LiteralPath $ReadyFile -Value $PID
            run
            if ($LASTEXITCODE -ne 0) { throw "Server exited with $LASTEXITCODE" }
        }
    }
    Set-Content -LiteralPath $ReadyFile -Value $PID
} catch {
    Write-Host $_ -ForegroundColor Red
    Set-Content -LiteralPath ($ReadyFile + '.error') -Value $_
}
# Leave the console open long enough for a screenshot; the capture script cleans up.
while ($true) { Start-Sleep -Seconds 1 }
