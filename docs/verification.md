# Verification and distribution

## Locally verified

- Windows PowerShell **5.1.26100.9549**, Node.js **26.3.1**, npm **11.16.0**.
- `npm test`: **20 passing tests**, including real npm script execution and Windows argument escaping.
- `npm run test:installer`: successful fresh installation, paths with spaces, reinstall, version/help, `Invoke-Expression` execution, unchanged PATH in `-NoPathUpdate` mode, rejection of unrelated directories, and preservation of a working installation after an invalid update.
- `scripts/test-installer.ps1 -TestPortableNode`: with Node removed from the test process's PATH, the installer downloaded real Node.js LTS, verified its SHA256, and successfully ran both `run` and bundled npm.
- Actual default installation: `%LOCALAPPDATA%\Programs\run`; `Get-Command run` resolved to its `bin\run.cmd`; `run --version` returned `0.1.0`.
- Repeated installation left exactly **one** matching entry in the persistent user PATH.
- `npm pack --dry-run`: valid package, only the CLI source, package metadata, license, and README included.
- Real React/Vite demo: the installed `run` command detected the project, ran `npm ci`, and launched Vite **6.4.3** at `http://127.0.0.1:5173/`. An HTTP request returned **200** and the expected demo HTML. This is an HTTP/console check, not a browser-interaction test.
- Demo processes were stopped after capture.

## Screenshots

- [`screenshots/01-install.png`](screenshots/01-install.png): actual local-archive installation, PATH setup, version, and command resolution.
- [`screenshots/02-dry-run.png`](screenshots/02-dry-run.png): automatic detection and explicit preview-script planning.
- [`screenshots/03-react-vite.png`](screenshots/03-react-vite.png): real dependency installation and running development server.

`scripts/capture-demo.ps1` uses the Windows `PrintWindow` API to capture only the console it created, including when other applications cover it. It does not render simulated terminal output. The local archive mode is explicit in the screenshot; the public GitHub download was **not** claimed as verified while the repository was empty.

## Make the public installer live

The reviewed files were committed and pushed to `main` at `https://github.com/xonix97/run` in commit `827aa82`. The public raw installer was then fetched and executed against a temporary destination; it downloaded the GitHub archive and returned version `0.1.0`. GitHub authentication was required to push, but npm authentication was not.

Verify the public commands in a fresh shell:

```powershell
(iwr -useb https://raw.githubusercontent.com/xonix97/run/main/install.ps1).Content | iex
run --version
(Get-Command run).Source
```

Or install with npm directly from GitHub:

```bash
npm install --global git+https://github.com/xonix97/run.git
run --version
```

The GitHub Actions workflow is included but remote CI has not yet run. Only the Windows results above were executed locally.
