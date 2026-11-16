# StudyBuddy on macOS

StudyBuddy starts at version **0.1.0**, with bundle identifier
`io.github.xuyouo.studybuddy`. It is based on Papilot; the original MIT license
and contributor credits are preserved.

## Development

Use the official Node.js **22.23.5** distribution (`.node-version`), npm, Xcode
Command Line Tools, Git and MacTeX. The local runtime lives at
`~/.local/share/studybuddy/node-v22.23.5-darwin-arm64` on Apple Silicon.
The system Node installation is unchanged.

```sh
export PATH="$HOME/.local/share/studybuddy/node-v22.23.5-darwin-arm64/bin:$PATH"
npm ci
npm run setup:review
npm run typecheck
npm test
npm run build
npm run desktop
```

Run `./dev.local.sh` to build, verify, install into `/Applications/StudyBuddy.app`
and launch. `./dev.local.sh --build-only` stops after building and verification.
Quit the installed app before replacing it. The installer preserves the previous
application under `~/Library/Application Support/StudyBuddy/Build Backups/`.

## Identity, signing and data

Local builds use a fresh ad-hoc signature for the StudyBuddy bundle and helpers,
with hardened runtime and the Electron JIT/library entitlements. No Developer ID
certificate or Apple notarization is required for this local installation.
These artifacts are not notarized distribution releases. Signing policy follows
[electron-builder 26](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/).

Desktop data lives in `~/Library/Application Support/StudyBuddy`; logs live in
`~/Library/Logs/StudyBuddy`. CLI data defaults to `~/.studybuddy`; development
server data defaults to the checkout's `.studybuddy/`. The existing `PAPILOT_*`
environment variables, agent identifiers and paper metadata remain compatible.

The package is private and `updatesEnabled: false` disables application update
checks and activation. Rebuild locally to update. Agent login and SDK setup still
work normally. Help links point to the StudyBuddy repository.

## Branding assets

`desktop/assets/icon.svg` is the editable macOS icon: a white open book and amber
bookmark on a teal tile. `src/web/logo.svg` and `docs/assets/logo.svg` carry the
same book mark. Regenerate the ICNS, PNG, ICO and favicon exports with
`node scripts/render-icon.mjs` after installing the review engine's Playwright
dependency and Google Chrome. The SVG remains resolution independent and the
existing decorative images keep empty alt text, following the Modern Web
Guidance `html` and `accessibility` guides.

## Local verification (2026-11-16)

Verified on macOS 27.0.1, Apple Silicon, with the pinned Node 22.23.5 runtime:

- Type checking and production builds passed.
- Root tests: 1,028 passed, 14 platform/optional checks skipped, no failures.
- Review engine: all 656 tests passed, followed by its production build.
- Workspace browser checks, all locale checks, and website checks passed.
- Rebuilt the demo PDF and README images; inspected the native workspace,
  settings, mobile layout, and icon at small sizes on light/dark backgrounds.
- The packaged app passed native startup, PDF, notification, IPC isolation,
  restart, port recovery and persistence checks with disposable data.
- Strict deep signature verification passed with the StudyBuddy bundle ID,
  ad-hoc signing and hardened runtime.

These checks did not submit live model prompts. Linux, Windows and Intel Mac
installers were not built during this local Apple Silicon setup.
