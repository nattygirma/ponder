# AGENTS.md

This file sets the rules for AI agents and contributors working on this project.

## Documentation rules

- **Stack and background**: start with `README.md`.
- **Mobile platform boundaries**: the Android client is in `apps/mobile` and uses Expo / React Native. The iOS client is in `apps/ios` and uses native Swift / SwiftUI.
- **Documentation sync**: documentation is written in English. When you change the root README, update `README.md`, `README.ja.md` and `README.pl-PL.md` together.

## Change risk assessment

- **Fix for all users**: when a user asks for a problem to be solved, put the fix in the repository's product code so every user gets it in later releases. Do not only change the maintainer's local configuration, processes or temporary state.
- **Assess before implementing**: before starting, state the value of the feature, its scope, the worst outcome, the rollback plan and what is unverified. Requests with low value that could disturb mature flows should be declined by default, or met with a lower-risk alternative.
- **Be strict on core flows**: any change to the mechanism or configuration of the installer, auto-update, data storage, authentication or migrations is high risk. Verify the real upgrade path from the old version to the new one, not just the new version on its own.
- **No unsupported guarantees**: when verification on the relevant platforms and across versions is incomplete, state the risk clearly. Never claim "does not affect existing users" or "does not affect auto-update".

## Android debugging rules

- **USB devices first**: Android debugging must use a real device connected over USB with `adb`. Do not start or use QEMU, AVD or other Android emulators. When no usable device is connected, state clearly that device verification is incomplete, and do not substitute emulator results.

## GitHub communication language

- When replying to an Issue or PR, or submitting a PR Review (including inline comments), use the main language of the other person's text or the current discussion.
- If the other person names a language, use it. If the language is mixed or unclear, default to English.
- Do not switch language in an Issue or PR because of the language used in a local conversation with the maintainer.
- **Commits based on an Issue**: if the current work is based on an Issue, link that Issue when committing and pushing.
- **Ownership of CI failures at merge time**: CI failures confirmed to already exist on `main` and not introduced by the current PR are the maintainer's to fix. Do not ask the PR author for unrelated fixes, and do not block the merge on those failures alone. Verification relevant to the current change is still required before merging. Failures the current PR introduces are for the PR author to fix.
- **Sync locally after merging**: after an agent merges a PR into `main`, if the local checkout is on `main` and the working tree is clean, it must `git fetch` and fast-forward to `origin/main` before ending the task. If the working tree is dirty or cannot fast-forward, stop and explain. Never reset, rebase or overwrite local changes. Syncing code does not include running database migrations.

## GitHub Actions and release rules and process

1. **Fork workflow boundaries**: GitHub Actions must account for the many users who fork the repository to self-host. Jobs needed only by the official repository must be gated with `github.repository == 'tianma-if/edgeever'`. Never allocate runners or run them in downstream forks.
2. **Version numbers and baseline**: `vX.Y.Z` (not Draft or Prerelease). Releases must pass an explicit `--bump patch|minor|major` (the script does not choose a level). Follow SemVer. **Never squeeze user-visible new capabilities or platforms into a patch to suit the release schedule.** Bump the root `package.json`. When mobile changes are included, also sync `expo.version` in `apps/mobile/app.json` and bump `android.versionCode`. The previous formal Release is the audit baseline.
3. **Cross-platform release assets**: every formal Release page must include the macOS arm64 DMG, macOS x64 DMG, Windows x64 Preview installer, Linux x64 AppImage Preview and Android arm64 APK. When the Windows Preview is not Authenticode signed, it must also ship an update manifest signed with an Ed25519 private key held outside the repository. The Linux Preview must include `latest-linux.yml` update metadata and a separate SHA-256 manifest. Both must pass an independent download and digest audit before release. If the native runtime code, dependencies, configuration or build tools for a platform did not change, reuse the verified original assets from the previous formal Release, keep their file names and checksums, and do not rename them just to match the new version. The Android APK in the official repository's formal Release must use the fixed Google Play app signing certificate. An APK signed with a local upload certificate may only be a temporary Draft asset, and must not be published without Play-signed replacement and the pre-release gate check.
4. **Verification commands**: `bun run typecheck`, `bun run typecheck:mobile` and `bun run build:web` must pass.
5. **Test responsibilities**: a formal Release must first pass the full non-E2E tests in the official repository, in an Ubuntu environment matching downstream. Never leave upstream's own test failures for downstream forks to discover. Read-only deployment forks only sync the product snapshot and do not run tests. Only forks that explicitly keep custom changes verify the merge result, and on failure they must leave `main` and production unchanged.
6. **Building and reusing native assets**: `scripts/plan-native-release.mjs` decides whether to rebuild or reuse. Desktop assets include `apps/web`. When you change the decision rules, update the tests too. Mobile rebuilds use `bun run build:android:apk:local`, and signing configuration is stored outside the repository.
7. **Preparing assets in Draft**: prepare and verify assets in the Draft through `workflow_dispatch` with `release_tag`. When Android is rebuilt, the Draft stage must complete Google Play delivery, replace the temporary asset with the Play-signed APK, and pass the independent signature gate. The `published` event only audits. It must never rebuild or upload, and on a signature mismatch it restores the Draft.
8. **Desktop verification responsibilities**: the desktop Release workflow handles tests, package structure checks, signing and notarization. Agents no longer re-download the Draft or do local first-launch acceptance unless the user explicitly asks.
9. **Updates after release**: after a formal release, the release flow must by default not download, overwrite-install or launch `/Applications/Ponder.app`. Installed macOS, Windows and Linux desktop apps get new versions through the in-app auto-updater, and the Linux Preview must pass a real AppImage cross-version update gate in the Draft stage. Use `--install-desktop` for the original install acceptance only when the user explicitly asks. The user verifies the feature experience in real use.
10. **Handling failures**: when a Release-blocking workflow or asset audit fails, keep or restore the Draft, fix the problem and re-run. Never publish a Release known to be broken. The GHCR image is a blocking gate. The Tencent Cloud TCR public image is synced and audited asynchronously by a separate workflow after formal release, and its duration or failure must not block the GitHub Release or return a published version to Draft.
11. **Release notes structure**: write in English (the body must not contain a literal `\n`). Cover only user-visible changes, their impact, and any necessary upgrade or migration notes. Technical verification details such as type checks, build commands, signing, notarization and asset reuse stay in Actions and the linked Issues, not the public Release body. Link features and fixes to their Issues and label them, then link back and close the Issues after release. Body structure:

```md
## Key Changes

- User-facing summary of changes in English.

Related Issue: #<issue-number>
```

12. **External contributor credit**: the maintainer needs no credit. Credit external contributions individually with account and PR, or in a single thanks. Do not repeat names in the body list, and keep GitHub's native Contributors avatar section. For parameter usage see `docs/release.md`.

## Environment, deployment and component rules

- **AI model APIs go directly from the client first**: AI model API requests on every platform and feature should call the model service directly from the client first. When the Web client hits browser network or CORS limits, it may fall back through the Ponder backend. Desktop and native mobile stay direct. Once an HTTP response exists or streaming has begun, do not automatically switch to the backend and repeat the call because of an error.
- **Cloudflare deployment**: follow `docs/agent-deploy-cloudflare.md` exactly.
- **Default Cloudflare deployment entry**: keep Fork + Workers Builds and the existing upstream sync mechanism. Unless explicitly asked, do not switch to a Deploy to Cloudflare template entry that would change how forks sync.
- **Cross-runtime architecture**: the project will formally support Docker self-hosting. New features must keep business logic decoupled from Cloudflare and leave extension boundaries for other runtimes. Cloudflare and Docker must share the same business code. Only thin, stable run entries and infrastructure driver adapters with no business decisions may differ.
- **Database migrations**: when the database or seeds change, add a new incrementally numbered SQL file under `migrations/`. Never modify an old migration that has already run.
- **Database read budget**: backups, pagination, sync and polling must account for the cumulative reads of the whole operation. Do not repeat full scans or counts per page or per poll. Verify how reads grow with pages and data volume using representative local data, and add regression tests. Do not verify with full scans or load tests on production. Quota exhaustion must be diagnosed clearly, not just reported as "try again later".
- **Releases and instance recovery**: passing Release assets do not mean live instances work. When deployment, migration or quota failures are found, check the actual server version and health of the instances involved, and report clearly what is not deployed or not recovered. Do not treat a client upgrade or a quota reset as the server fix having taken effect.
- **Local startup**: the default is `bun run dev` (fully local). When the user asks to "start/restart the Web client", include Web and API by default and use `bun run dev`. Use `bun run dev:web` only when the user explicitly asks for frontend only or names `dev:web`. To target a remote instance use `PONDER_INSTANCE=<instance-name> bun run dev:remote`.
- **Demo content sync**: after changing the sample notes, run `bun run demo:sync` on a clean `main` to reset the public Demo.
- **Do not reinvent the wheel**: never re-implement a mature existing solution. Prefer actively maintained, widely proven open-source components and dependencies, prefer reusing `shadcn/ui`, and wrap complex or repeated modules as standalone components.
- The principle for UI and interaction: the product always feels reliable, predictable, certain, and like it has caught you.
- **Hover hints**: never use the native HTML `title` for hover or focus hints. The Web client must use the shadcn/ui Tooltip component everywhere, and hints must also be visible on keyboard focus.

## Brand identity

- **Brand color**: reuse the existing UI black and gray palette. The logo mark color is `#07130B`.
- After changing the logo, run `bun run prepare:brand:icons` to sync assets across platforms.
