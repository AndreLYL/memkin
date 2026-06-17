# Desktop Release — required GitHub Secrets

The `desktop-release.yml` workflow builds + publishes the 3-platform desktop app and signs
the auto-updater artifacts. Add these under **Settings → Secrets and variables → Actions**.

## 1. Updater signing — REQUIRED

`createUpdaterArtifacts` is on, so the build **fails without** the updater signing key.
The keypair was generated locally with `cargo tauri signer generate`:

- Public key: already committed in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Private key: `~/.memoark/desktop-keys/memoark-updater.key` (kept OUT of the repo).

| Secret | Value |
|--------|-------|
| `TAURI_SIGNING_PRIVATE_KEY` | full contents of `~/.memoark/desktop-keys/memoark-updater.key` (`cat` it) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | empty string (the key was generated with `--ci`, no password) |

> ⚠️ If you lose this private key you can never ship a verifiable update again — back it up.

## 2. macOS code signing + notarization — OPTIONAL (recommended for public distribution)

Without these, macOS still builds but the app is **unsigned** → Gatekeeper warns users
("unidentified developer"). To sign + notarize you need an Apple Developer account ($99/yr).

| Secret | What |
|--------|------|
| `APPLE_CERTIFICATE` | base64 of your "Developer ID Application" cert exported as `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID` | your Apple ID email |
| `APPLE_PASSWORD` | an app-specific password for notarization |
| `APPLE_TEAM_ID` | your 10-char Apple Team ID |

## 3. Windows code signing — OPTIONAL

Without it the Windows installer is unsigned (SmartScreen warns). Windows signing setup
varies (OV/EV cert, Azure Trusted Signing). Wire it via `bundle.windows` in
`tauri.conf.json` + the matching secrets once you have a cert — left as a TODO.

## Releasing

```bash
# bump version in src-tauri/tauri.conf.json, then:
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

The workflow builds all platforms, publishes a **draft** release with installers +
`latest.json`. Review, then publish. The in-app updater reads:
`https://github.com/AndreLYL/memoark/releases/latest/download/latest.json`.

## Degrade matrix

| Secrets present | Result |
|-----------------|--------|
| none | ❌ build fails (updater key required) |
| updater key only | ✅ builds + auto-update works; apps unsigned (Gatekeeper/SmartScreen warn) |
| + Apple (+ Windows) | ✅ fully signed + notarized, no OS warnings |
