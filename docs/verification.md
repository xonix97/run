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

At implementation time `https://github.com/xonix97/run` existed but contained no files, and this local directory was not a Git checkout. No remote commit or push was performed. From the project root, after reviewing the files:

```bash
git init -b main
git add .
git commit -m "Add run CLI, Windows installer, tests, and screenshots"
git remote add origin https://github.com/xonix97/run.git
git push -u origin main
```

These instructions assume the remote is still empty. If it has since gained commits, clone it and copy the reviewed files into that checkout instead of force-pushing. GitHub authentication is required to push, but npm authentication is not.

Then verify the public commands in a fresh shell:

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
