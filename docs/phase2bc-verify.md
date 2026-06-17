# Phase 2b / 2c — verification

Branch `feat/desktop-app`, host `aarch64-apple-darwin`. Rust 1.96, tauri-cli 2.11.2, Bun 1.3.14.

## 2b — tray-resident + close-to-tray + native menu + autostart

| Item | Status | Evidence |
|------|--------|----------|
| Code compiles | ✅ | `cargo check` clean |
| Tray icon builds | ✅ | app launches (tray build uses `?`; failure would abort setup) |
| App resident + backend online | ✅ | after launch: app process up, `GET /` 200 |
| Quit (tray/Cmd+Q) → kill sidecar | ✅ | after quit: no procs, 3927 freed |
| Autostart defaults OFF | ✅ | no `~/Library/LaunchAgents/*memoark*` until toggled |
| Close-button → hide (not quit) | ⚠️ manual | code-verified; can't click in sandbox (macOS Accessibility blocks UI automation, err -1719) |
| Tray menu clicks (显示/退出/自启) | ⚠️ manual | same Accessibility limitation |

**Manual 30-sec check (please do once):** launch `MemoArk.app` → click the red close button →
the window should disappear but the app stays in the menu-bar tray and `curl localhost:3927/`
still returns 200 → click tray → 显示 reopens, 开机自启 toggles a `~/Library/LaunchAgents`
plist, 退出 quits + frees the port.

## 2c — 3-platform CI + signed auto-updater + signing scaffold

| Item | Status | Evidence |
|------|--------|----------|
| Updater plugin + config compiles | ✅ | `cargo check --release` clean (the check block is release-gated) |
| Signed updater artifacts | ✅ | `cargo tauri build --bundles app,updater` → `MemoArk.app.tar.gz` + `.sig` |
| Updater keypair | ✅ | generated; pubkey in `tauri.conf.json`, private key at `~/.memoark/desktop-keys` (out of repo) |
| App still launches/serves/quits | ✅ | regression after identifier change + updater plugin: `GET /` 200, clean quit |
| CI workflow valid | ✅ | YAML parses; macOS arm64+x64 / Windows / Linux matrix via tauri-action |
| identifier `.app` warning | ✅ fixed | → `ai.memoark.desktop` |
| DMG bundling | ⚠️ env | fails **locally only** — create-dmg needs AppleScript/Finder automation, blocked in this sandbox; works on CI runners. Verified updater via `--bundles app,updater`. |
| Apple/Windows code signing | 🔑 needs creds | wired in CI with graceful degrade; can't test without certs |
| Auto-update end-to-end (download+install) | 🔑 needs release | check is release-gated; needs a published GitHub Release to exercise |

## What the user must provide (see docs/desktop-release-secrets.md)

- **Required**: `TAURI_SIGNING_PRIVATE_KEY` secret = contents of `~/.memoark/desktop-keys/memoark-updater.key` (else release build fails — `createUpdaterArtifacts` on).
- **Optional**: Apple Developer cert + notarization creds, Windows code-signing cert (else unsigned builds; Gatekeeper/SmartScreen warn).

## GO summary

2b + 2c **implemented and locally verified** as far as the sandbox allows. Remaining gaps are
environment/credential bound, not code: tray click-interactions need a manual check; DMG needs a
CI runner; signing/notarization + live auto-update need the user's secrets and a first release.
