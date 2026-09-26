# Silo

A cross-platform desktop S3 client built with Tauri 2 + React.

## Features (Core)

- Multi-account management (AWS, MinIO, Cloudflare R2, DigitalOcean Spaces, custom)
- Secure credential storage via the OS keychain
- Bucket list / create / delete
- Object browser with upload, download, delete, rename/move, folders
- Multipart uploads for large files with live progress
- Bucket ACL + bucket policy editor with public-access warnings
- Command palette (`⌘K` / `Ctrl+K`)

## Develop

Prerequisites: Node 20+, pnpm, Rust stable, platform deps from [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
pnpm install
pnpm tauri dev
```

## Build

```bash
pnpm tauri build
```

Produces a native app bundle under `src-tauri/target/release/bundle/`.

- macOS: `macos/Silo.app` and `dmg/Silo_0.1.0_*.dmg`
- Or DMG only: `pnpm build:dmg`

Release builds are code-signed with your local **Apple Development** identity (see `src-tauri/tauri.conf.json`). That makes the app officially signed on your Mac (stable identity across rebuilds).

To distribute to others without Gatekeeper warnings you need a paid Apple Developer Program **Developer ID Application** certificate plus notarization — then set:

```bash
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
pnpm tauri build
```

### App icon

Source: `assets/silo-app-icon.png`. Regenerate all sizes with:

```bash
pnpm tauri icon assets/silo-app-icon.png
```

### Cursor / VS Code task

**Terminal → Run Task… → Build Silo DMG** (also the default build task: `⌘⇧B` / `Ctrl+Shift+B`).

When finished, run **Open Silo DMG folder** or:

```bash
open src-tauri/target/release/bundle/dmg
```

## Run the built app (macOS)

```bash
open src-tauri/target/release/bundle/macos/Silo.app
```
