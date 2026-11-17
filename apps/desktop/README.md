# Vrata Desktop

macOS, Linux, and Windows Electron shell for Vrata. The desktop app loads the existing bb
web UI and uses the packaged `bb-app` launcher for server and host-daemon
lifecycle.

## Browser address interaction checks

Run `pnpm exec turbo run smoke:browser-address --filter=@bb/desktop` from the
repository root. On Linux, run it under `xvfb-run -a` or an active display.
The smoke test mounts the production address input beside a real Electron
`WebContentsView`, checks repeated focus transfers, first and second clicks,
drag selection, keyboard focus, and replacing the selected URL by typing.
It uses a temporary profile and removes it when finished. It needs no running
BB server or user data. CI runs it alongside the desktop tests.

## Development

From the repo root, run `pnpm dev` in one terminal for the source server and
live UI updates. In a second terminal, start the Electron shell:

```bash
pnpm exec turbo run dev --filter=@bb/desktop
```

The dev script builds `bb-app`, compiles the Electron main/preload files, and
opens Electron directly. By default it uses the same checkout-scoped
`~/.bb-dev/<checkout-instance>` data directory and deterministic high ports as
`pnpm dev`; it prints the resolved data dir, server URL, and
Electron user-data dir at startup. It intentionally overwrites inherited
`BB_DATA_DIR`, `BB_SERVER_PORT`, `BB_SERVER_URL`, and `BB_HOST_DAEMON_PORT` so a
desktop dev run launched from an existing bb session still targets the current
checkout. Set `BB_DESKTOP_USER_DATA_DIR` to override only Electron's user-data
directory.

The launcher probes the checkout's Vite app port at startup and adapts:

- **`pnpm dev` is already running** (Vite reachable): the shell loads the Vite
  dev URL, so you get live source and HMR for `@bb/app` changes — no rebuild
  needed. It still attaches to the same running server/daemon for all API/WS
  traffic. The launcher prints `app <url> (Vite dev server — live reload)`. This
  is the fast loop for iterating on the desktop UI.
- **`pnpm dev` is not running**: the shell starts its own `bb-app` runtime and
  loads the built UI it serves, so you must rebuild (re-run this task) to pick up
  source changes. The launcher prints `app (own bb-app runtime — …)`.

The override is plumbed via `BB_DESKTOP_APP_URL`, which the launcher only sets
when Vite is confirmed reachable; it is never set in packaged builds, so
production always loads the server's own built UI.

To run the slower unpacked Electron Builder app, which more closely matches the
packaged runtime and keeps native dependencies rebuilt for Electron's bundled
Node runtime:

```bash
pnpm exec turbo run start --filter=@bb/desktop
```

Electron is pinned to `44.9.3`. macOS builds require macOS 13 (Ventura) or
newer. The bundled `bb-app` runtime uses `better-sqlite3@13.0.3`, whose N-API
binaries work with Electron without an ABI-specific rebuild. The packaging
hook opens an in-memory database with Electron before accepting the packaged
SQLite module; older ABI-specific modules still use the prebuild fallback.

macOS notifications require a signed application. Unsigned local and CI artifact
builds cannot display macOS notifications. Published releases use the existing
signing and notarization workflow.

The shipped Linux x64 SQLite prebuild requires glibc 2.34 or newer and
libstdc++ with `GLIBCXX_3.4.29` support (GCC 11 or newer).

The AppImage packaging patch exposes its bundled legacy `libnotify` only as
`libnotify.so`. Electron first tries the system's versioned library names, so
libnotify 0.7.10 or newer can supply notification activation tokens on Wayland.
If no versioned system library loads, Electron can still use the bundled
unversioned fallback for notifications. Older libraries keep their existing
notification behavior but cannot forward activation tokens.

Electron downloads its development runtime lazily; the desktop test command
installs it before starting parallel workers.

The macOS bundle declares macOS 13 as its minimum. The release feed generator
writes the corresponding Darwin kernel minimum, 22.0.0, into both JSON and YAML
update feeds. Run it before publishing release artifacts so older Macs reject
incompatible updates.

## Window state

Window position, normal size, maximized/fullscreen state, and zoom are saved in
`window-state.json` in Electron's user-data directory. Geometry changes save after
500 ms of inactivity, and closing a window flushes immediately. A crash can lose
changes still within that debounce interval. Writes replace the file atomically.
Closing one of several windows removes it from the next launch; closing the final
window keeps its state for Dock reopening and the next launch. Quitting with
multiple windows open restores those windows individually. Zoom is one app-wide
value because Chromium shares zoom across windows on the same origin: zoom
commands apply to every window, new windows open at it, it saves immediately,
and it survives reloads and server switches.

## Validation

The built-in browser allows file downloads using Electron's native save dialog.
Files are saved on the machine running the desktop app, including downloads
initiated in desktop browser automation tabs.

```bash
pnpm exec turbo run typecheck --filter=@bb/desktop --filter=bb-app
pnpm exec turbo run build --filter=@bb/desktop
pnpm exec turbo run test --filter=@bb/desktop --filter=bb-app --force
pnpm exec turbo run dev --filter=@bb/desktop
```

The desktop tests include an Electron startup smoke that opens a real window.
On Linux it runs only when `DISPLAY` is set; on a headless host, wrap the test
command in `xvfb-run -a`, as CI does.

## Packaging

```bash
pnpm exec turbo run desktop:build --filter=@bb/desktop
pnpm exec turbo run smoke:packaged --filter=@bb/desktop
```

Artifacts are written under `apps/desktop/release/`. The macOS build is Apple
Silicon arm64-only; Intel Macs are not a target. Without signing secrets, local builds
sign with a code-signing identity auto-discovered from the keychain and skip
notarization. A valid signature matters even for local builds: macOS
provenance-tracks unsigned apps, forcing syspolicyd to evaluate every exec in
the app's process tree, which can stall process launches system-wide. On
machines with no keychain identity (or with `CSC_IDENTITY_AUTO_DISCOVERY=false`,
as CI sets for workflow-artifact-only builds), artifacts remain unsigned and
macOS shows the normal Gatekeeper warning on first launch.

For local verification without publishing, use
`pnpm exec turbo run package --filter=@bb/desktop` on macOS, or
`pnpm exec turbo run package:linux --filter=@bb/desktop` on Linux.

npm's bundled dependencies are copied through an explicit `files` entry into
`node_modules/npm/node_modules`, including nested dependency versions. pnpm's
dependency listing omits this bundled tree, and electron-builder's dependency
copier excludes nested `node_modules`. `asarUnpack` alone cannot preserve files
that the collector never selected. The explicit file set enters both ASAR's
file index and its unpacked resources before signing.

Packaging runs an offline npm smoke check in `afterPack`, before signing or
publishing. This requires a native target host (macOS arm64, Linux x64, or
Windows x64). `smoke:packaged` then verifies the resulting app opens and its
desktop preload bridge works. To rerun npm verification independently without
opening a desktop window:

```bash
pnpm exec turbo run smoke:packaged-npm --filter=@bb/desktop
pnpm exec turbo run smoke:packaged-npm --filter=@bb/desktop -- /absolute/path/to/bb.app/Contents/MacOS/bb
```

On Linux, the optional argument is the executable inside `linux-unpacked/` or
an extracted AppImage. The check resolves npm from packaged `bb-app`, audits
required dependency edges and version ranges in npm's entire bundled tree using
both CJS and ESM resolution, rejects paths outside packaged resources, imports npm's ESM display
dependencies, and verifies its version. It then uses bundled Electron and npm
to pack, install, and update a disposable plugin's dependency from 1.0.0 to
2.0.0, verifying the lockfile and importing the plugin's ESM entry after each
install. It uses the plugin install flags, an empty PATH, offline mode, a fresh
HOME/cache/config, and disabled lifecycle scripts. No system Node/npm or user
store is used by the child processes. It also hashes ASAR and unpacked resources
before and after to reject bundle mutations. Fixtures are removed afterward.

The bb-app tarball smoke covers a different packaging pipeline and cannot
detect Electron artifact omissions. A source build or `npm --version` alone
does not verify a desktop plugin dependency install.

### Windows (NSIS, x64)

Windows packaging needs a Windows x64 host; `afterPack` refuses to cross-build
because it verifies the packaged native modules by loading them. From the repo
root, install with `pnpm install --frozen-lockfile --ignore-scripts`, then build
an unpacked app, an installer, or smoke test the current packaged output with:

```powershell
pnpm exec turbo run package:win --filter=@bb/desktop
pnpm exec turbo run desktop:build:win --filter=@bb/desktop
pnpm exec turbo run smoke:packaged --filter=@bb/desktop
```

`desktop:build:win` writes `release/vrata-bb-<version>-x64.exe`, a one-click per-user
NSIS installer that installs to `%LOCALAPPDATA%\Programs\bb` without
elevation, plus `latest.yml` for electron-updater.
Without a signing certificate the installer is unsigned, so Windows SmartScreen
warns before running it. electron-builder signs it when `WIN_CSC_LINK` (a
base64 `.pfx`) and `WIN_CSC_KEY_PASSWORD` are set. The Vrata workflow
currently produces unsigned Windows installers.

`afterPack` copies `@parcel/watcher-win32-x64` into the package when
electron-builder leaves it out and loads it with the packaged Electron; without
it the file watcher cannot start.

Windows builds check `desktop-version-windows.json` for new versions and
install them with electron-updater from `latest.yml` (`nightly.yml` on the
nightly channel). The update downloads in the background and the installer runs
silently when the app quits or when the user chooses Relaunch.

### Linux (AppImage, x64)

Linux packaging targets x64 glibc-based distributions. Install `python3`,
`make`, and `g++` so node-gyp can build node-pty during dependency installation.

From the repo root, build an unpacked app, an AppImage distribution, or smoke
test the current packaged output with:

```bash
pnpm exec turbo run package:linux --filter=@bb/desktop
pnpm exec turbo run desktop:build:linux --filter=@bb/desktop
pnpm exec turbo run smoke:packaged --filter=@bb/desktop
```

Running an AppImage normally requires FUSE and, on some distributions, the
`libfuse2` compatibility package. If FUSE is unavailable, launch it with
`--appimage-extract-and-run` instead.

Linux users whose window manager supplies all window controls can remove the
native Electron title bar with `--no-window-frame`:

```bash
./bb-x86_64.AppImage --no-window-frame
```

The native frame remains the default. Changing this startup option requires a
full desktop app restart.

Linux users can opt into a transparent Electron window with
`--transparent-window`:

```bash
./bb-x86_64.AppImage --transparent-window
```

The window remains opaque by default. Transparency also requires a compositor
that supports it, and Electron documents limitations including unsupported
window shaping and unreliable resize behavior on some platforms. The flag can
be combined with `--no-window-frame`, and changing it requires a full desktop
app restart.

CI builds Linux artifacts on the pinned `ubuntu-22.04` runner. The AppImage
links against the build machine's glibc, so that pin sets the oldest
distribution that can run a published build. Raise it deliberately.

Linux gets both update paths, but they are not equivalent:

- The JSON version feed (`desktop-version-linux.json`) is polled on every Linux
  install and reports that a newer release exists.
- Self-installing auto-update runs only inside an AppImage whose directory the
  app can write to. electron-updater detects the AppImage through the `APPIMAGE`
  environment variable, and its install step unlinks the running file _before_
  moving the replacement in — so a read-only directory would delete the app and
  leave nothing behind. Both the startup check and the install handler verify
  write and search access on the parent directory first.
- Everything else — an extracted directory, a distribution package, or an
  AppImage in a read-only location — reports new versions without installing
  them.

The Linux AppImage is unsigned, and electron-updater performs no signature
check on Linux: it verifies only the SHA-512 recorded in the update metadata
that ships beside it. macOS installs through Squirrel, which additionally
requires the replacement to satisfy the running app's code-signing
requirement. Write access to the release assets is therefore sufficient to
push code to Linux clients. Treat the release token accordingly.

## Releasing

The only Vrata Desktop release workflow is
[Vrata Desktop](../../.github/workflows/vrata-desktop.yml) in
`vrata-tg/vrata-desktop`. Pull requests build artifacts with read-only repository
permissions. A public release requires a manual `workflow_dispatch` on `main`
with `publish=true`; the default is `false`. Every job checks out the event SHA.
The workflow never bumps versions or fetches a newer plugin.

Keep `apps/desktop/package.json` and `packages/bb-app/package.json` at the same
plain SemVer, starting at `1.0.0`. Change both in a reviewed diff before release;
use `1.0.1` for the next patch. Plugin SDK `0.6.149` has its own version. The
original migration base is BB `0.49.0`, upstream SHA
`1320c88e8abdd3f145bc9a5c305eace269fb2f28`; release notes record this separately
from the Vrata Desktop version and the exact bundled plugin pin.

1. Review the two-workflow policy in
   [CONTRIBUTING.md](../../CONTRIBUTING.md#updating-from-upstream) and remove any
   unrelated workflows reintroduced by an upstream merge.
2. Merge the reviewed version/plugin changes into `main`.
3. Open Actions → Vrata Desktop → Run workflow, select `main`, and leave
   `publish=false`. Wait for all three builds and the final full-artifact check.
4. Review the `vrata-verified-release` artifact, its feeds, `SHA256SUMS`, and
   installers on native machines. Check the run's commit SHA. If `main` changes,
   repeat the dry run for that SHA before publishing it.
5. Configure the complete macOS signing/notarization secret set below. Run the
   workflow again from the reviewed `main` SHA with `publish=true`. All three
   platforms rebuild and must pass before the release job can write.

| Platform    | Installers     | electron-updater metadata | Version feed                   |
| ----------- | -------------- | ------------------------- | ------------------------------ |
| macOS arm64 | `.dmg`, `.zip` | `latest-mac.yml`          | `desktop-version.json`         |
| Linux x64   | `.AppImage`    | `latest-linux.yml`        | `desktop-version-linux.json`   |
| Windows x64 | NSIS `.exe`    | `latest.yml`              | `desktop-version-windows.json` |

Installer basenames are `vrata-bb-<version>-<arch>.<ext>`. Packaging always uses
`--publish never`. `desktop:version-feed` runs the existing JSON generator
through Turbo after packaging has produced YAML. The final verifier reads both
formats, checks version/channel/platform/architecture, file size and SHA-512
against the actual installers, and rewrites both feeds to immutable URLs under
`https://github.com/vrata-tg/vrata-desktop/releases/download/vrata-v<version>/`.
It preserves generated blockmaps and adds SHA-256 checksums for installers,
metadata and blockmaps. This check also runs when `publish=false`.

The release job creates a draft at the event SHA, uploads the complete asset set,
then downloads and verifies every asset before publishing it as Latest. A retry
can fill only a draft with the same version, source SHA and provenance, using
the original verified artifacts. Retry the failed release job to reuse them. A
published version, foreign draft, or tag pointing elsewhere blocks publication.
Immediately before promotion, the candidate must be strictly newer than the
published Latest SemVer. Runs for `main` share one concurrency group. Never
replace published assets; corrections need the next version.

For focused release-helper verification from the repository root:

```bash
pnpm exec turbo run test:vrata-release
node scripts/vrata-release.mjs --check-config
node scripts/vrata-release.mjs /path/to/combined-artifacts
```

The helper needs only the checkout and its frozen dependencies. The `upstream`
remote and upstream history are not release prerequisites.

### First installation over old Vrata

Old Vrata installations still read releases from the old `vrata-bb` repository.
Download the first Vrata Desktop release manually. Close the old app before
installing. On macOS, remove only the old `.app` bundle, then drag
**Vrata Desktop.app** into Applications and launch it. Preserve the existing
`.vrata-bb` profile, Electron application data and saved credentials. Do not
uninstall application data. The old release assets remain available.

Verify the profile, provider credentials and onboarding on a test profile before
using the new installation. Future updates use the existing desktop updater
between two new Vrata Desktop versions. A packaged update smoke test on each
supported platform is still required before claiming update readiness.

## About panel

The app menu's About item opens a message box listing the facts a bug report
needs: version, build type, commit, build date and how old that build is
("3 days old"), plugin SDK version, Electron version, and OS. Its **Copy**
button puts that whole block on the clipboard. The age is computed when the
dialog opens, so a long-running session still reports it correctly.

The native About panel is populated too, minus the age, since Electron takes
those options once at startup. `scripts/build.mjs` bakes the build-time half of
the facts into the bundles:

| Variable                | Default when unset                                    |
| ----------------------- | ----------------------------------------------------- |
| `BB_DESKTOP_COMMIT`     | `GITHUB_SHA`, else `git rev-parse HEAD`, else unknown |
| `BB_DESKTOP_BUILD_DATE` | The build's own timestamp, ISO 8601                   |

The plugin SDK version is read from `packages/plugin-sdk/package.json` at build
time. A checkout with no git metadata reports `Commit: unknown` rather than
failing the build.

## macOS signing + notarization

The workflow reuses `scripts/run-electron-builder.mjs` for Developer ID signing,
nested runtime signing and Apple notarization. Configure all five repository
secrets together:

| Secret                        | Value                                                                     |
| ----------------------------- | ------------------------------------------------------------------------- |
| `CSC_LINK`                    | Base64-encoded Developer ID Application `.p12`, including its private key |
| `CSC_KEY_PASSWORD`            | Password protecting that `.p12`                                           |
| `APPLE_ID`                    | Apple Developer account email                                             |
| `APPLE_APP_SPECIFIC_PASSWORD` | Apple app-specific password                                               |
| `APPLE_TEAM_ID`               | Developer Team ID                                                         |

Only the macOS packaging step of a manual `main` run receives these secrets.
PRs, other refs and the Linux/Windows/release jobs do not receive them. Missing
all five permits an unsigned dry run; a partial set fails. `publish=true`
requires the full set and successful signing/notarization. The workflow verifies
the packaged app with `codesign`, `spctl` and `stapler`, then records signing
evidence bound to the event SHA and installer hashes for the release job.
It never publishes a metadata-only or unsigned macOS release.

For local builds with no secrets, the native wrapper uses keychain identity
auto-discovery and skips notarization. Configure a usable Developer ID identity
for signed local builds. Release readiness additionally needs a native packaged
update smoke test with signed and notarized builds.

## Auto-update

The existing desktop updater reads the platform JSON feed and electron-updater
YAML from `https://github.com/vrata-tg/vrata-desktop/releases/latest/download/`.
Both formats point to immutable installers in `vrata-v<version>`. A complete
release becomes Latest only after all platform assets have been verified.
The distribution uses one `latest` channel and ordinary SemVer comparisons.

The upstream updater lifecycle, launch/periodic checks and download/install UI
remain in use. Local development skips Electron auto-update unless
`BB_DESKTOP_AUTO_UPDATE=1` is set.

To verify an installed macOS build:

```bash
spctl --assess --type execute --verbose "/Applications/Vrata Desktop.app"
codesign --verify --deep --strict --verbose=2 "/Applications/Vrata Desktop.app"
xcrun stapler validate "/Applications/Vrata Desktop.app"
```

## Debugging

Use the View menu to toggle DevTools. To open them automatically on launch, set
`BB_DESKTOP_OPEN_DEVTOOLS=1`:

```bash
BB_DESKTOP_OPEN_DEVTOOLS=1 "apps/desktop/release/mac-arm64/Vrata Desktop.app/Contents/MacOS/bb"
```

Unpackaged runs use `assets/icon-dev.png` for the Dock and window icon. Set
`BB_DESKTOP_DEV_ICON=1` to use it in a packaged build too; `pnpm
desktop:worktree` sets it. The bundle's own icon in Finder is unchanged.

Desktop main-process logs are written immediately to `desktop.log` under
`~/.vrata-bb/logs/` or `$BB_DATA_DIR/logs/` when `BB_DATA_DIR` is set, including
updater, Connect, and startup failures from launches without a terminal.
Logs append across launches and rotate at 10 MiB into `desktop.1.log` through
`desktop.4.log`. When bb-app exits, its captured output is saved
with the error. Logging failures fall back to stderr without interrupting
startup.

**View → Local Logs** shows desktop, server, and daemon logs on macOS, Windows,
and Linux, including when attached to an existing server or startup fails.
These are files in this computer's selected data directory; connecting to a
remote server does not fetch its logs. Use **Open Logs Folder** to inspect
rotated files. Scripts and agents can read the same files from the data
directory.

To verify attach-if-found manually, start a compatible bb first, then launch the
desktop app:

```bash
npx bb-app@latest
pnpm exec turbo run dev --filter=@bb/desktop
```

The desktop supervisor handles normal quits plus `SIGINT` and `SIGTERM`, and it
writes a PID file so the next launch can reap a stale Electron-owned `bb-app`
launcher. Hard crashes such as process aborts, segfaults, or kernel-level kills
cannot run cleanup in the crashing process; the startup PID-file reap is the
recovery path for those cases.

### Saved servers

Use **bb → Desktop Settings → Server → Add Server…** to save and switch to
another machine's HTTP(S) bb server URL. **Window → Server** opens the same
menu. Both native dialogs accept an optional friendly name (up to 64 characters).
The menu shows that name, or the URL hostname and port when unnamed. Saved URLs
remain in the menu across restarts; adding an existing URL
selects it without creating a duplicate. **This Mac** on macOS or **This
Computer** on Linux switches back to the built-in server without removing
saved entries.

**Edit Server…** edits the currently selected custom or Connect server and is
disabled for **This Mac** / **This Computer**. For a Connect server it changes
only the name; the address comes from the bb account and is read-only. For a
custom server, clearing its URL removes
that entry and, with Show This Mac/Computer checked, switches an active custom
target to the built-in server. Other
saved servers and Connect discovery remain available. Existing single-server preferences are
loaded automatically into the saved list in `<userData>/server-target.json`.

Changing only the name refreshes the menu without switching servers or reloading
windows, even when another target is active. Clearing the name restores the
hostname fallback. Editing a URL keeps the entry's position and supplied name.
Editing into an already saved URL removes the old entry and selects the existing
entry, preserving the destination's name and position. Adding an existing URL
with no name keeps its name; supplying a name updates it.

Names are stored alongside the saved URLs in
`<userData>/server-target.json` as `customServerNames`, keyed by normalized URL.
Existing unnamed saved servers still load. The name field is omitted when no
saved server has a name, keeping unnamed settings compatible with older builds.
Builds with tolerant saved-server parsing (#5286) load the URLs but drop names when rewriting preferences; older
builds with strict parsing can reject the added field on rollback. Invalid names
do not discard saved URLs, and names for absent URLs are ignored and pruned on
the next save.

Connect servers owned by your bb account appear in the menu by name, or by
URL hostname when unnamed, like custom servers. Their names are stored in `server-target.json` as
`connectServerNames`, keyed by handle, and are kept while discovery is
unavailable. A saved custom URL that is an account server's address is replaced
by that account server at startup, after discovery, and after Add/Edit Server.
Its name moves to the account server unless that server is already named. If
the replaced URL was selected, the app switches to the account server and
reloads its windows once.

Connect discovery tries the built-in server, then a stored machine credential,
then the bb account sign-in. When none of these load the servers and the app
has no credential or account sign-in, the Server menu offers **Sign in to bb
Connect…** above **Add Server…**. If bb Connect rejected the credentials, the
item is **Sign in to bb Connect again…**. Other failures add no menu row; the
menu keeps the servers from the last successful load, and the app logs the
reason as `connect server sync skipped (<reason>)`. The sign-in item opens
bb account sign-in in a desktop window, the same window as **Reconnect** below,
from any selected server, including **This Mac** / **This Computer**. Once the
new account session arrives, the window closes and the app reloads the
account's servers into the menu. Without a known Connect server, the app signs
in at `https://getbb.app`. Development builds use `BB_DEV_CONNECT_BASE_URL`
when it is valid.

The app command palette lists **Switch to <server>** for each inactive choice
from this same Server menu, including Connect discovery. Palette list requests
use the menu's discovery refresh policy (at most once per minute, with the
existing ten-minute background refresh). The optional `window.bbDesktop`
`getServerChoices`, `onServerChoicesChange`, and `selectServer` methods expose
only `{id, name, active}`; custom server IDs are opaque hashes. Selection is
validated against native choices and runs the menu's existing authentication,
window navigation, and runtime lifecycle. Older desktop shells omit these actions.

Desktop Settings → Server → **Show This Mac** (or **Show This Computer** off macOS)
defaults to checked and is disabled while This Mac/Computer is selected.
Unchecking hides the built-in server from server choices
while another server is active and alternatives exist. It stays listed when
active or when it is the only choice. This setting does not stop the local
runtime or change the active server.

The desktop stores `showBuiltinServer: false` in `<userData>/server-target.json`;
missing means shown, and saving the default omits the field. Other top-level
metadata is preserved. This is a desktop-local preference, with no server
settings CLI/SDK endpoint. Builds with tolerant readers ignore the field and
may drop it on save; older strict readers can reject the whole file, so keep a
backup before rolling back to a build predating the tolerant-reader fix #5286.

When a custom URL is removed while the built-in server is hidden, an active
custom target switches to the first remaining custom URL in saved order, then
the saved Connect server, then a discovered Connect server in handle order,
and finally the built-in server if no alternative exists. With the checkbox
checked, removing an active custom target still switches to the built-in server.
The native menus, renderer Server popup, and app palette use the same choices.

### Server moves

After `bb server move`, the old computer's data dir (`~/.vrata-bb` or
`$BB_DATA_DIR`) contains `server-moved.json`. The desktop app reads it at
startup, whenever the built-in server target loads, and while that target is active.
While the target is active, the app watches the data dir. If `fs.watch` fails,
for example with `ENOSPC`, the app checks the file every 2 seconds instead
(`src/server-moved.ts`). The server writes the lock before the new machine
takes over and removes it if the move is rolled back, so the app acts only on a
committed move. A move is committed when the local server address answers
`/health` with 410 `code: "server_moved"`, or when nothing listens there and no
launcher process is alive. The app checks once when it starts or loads the
built-in server. When a move finishes while the app is open, the app checks every
second for up to 120 seconds. It stops if the lock disappears. The first time the app
sees a committed lock for a `moveId`, it switches the server target once:

- `mode: "connect"` selects `connectHandle` with `serverUrl`.
- `mode: "direct"` sets the custom server URL. When a move finishes while
  the app is open, the app waits up to 60 seconds for the new `/health`
  endpoint before it switches the window.

The app shows "Your bb server moved to <toHostName>" once for each `moveId`
(`<userData>/server-move-notice.json`). It still starts its own `bb-app`
launcher unless another bb process answers the local server port. The launcher
runs this computer as a regular machine, and quitting the app stops it. If the
app has no stored bb Connect credential, it signs in to a connect target with
the `x-bb-connect-machine` header that the move wrote to the data dir's
`config.json`. The app logs a warning and ignores an invalid lock.

On startup, a saved built-in server choice also switches to the moved server;
it never starts the old copy automatically. A different saved remote server
choice remains selected. Explicitly picking the built-in server while the move
lock exists shows "bb moved to <toHostName>" with **Open <toHostName>** and
**Choose server…**. The screen explains whether the old copy is locked or was
deleted. Selecting the built-in server does not unlock the old copy or remove
its background machine service.

Startup error screens list their actions as buttons. Any screen where
retrying can help shows **Try again**. **Choose server…** opens the Server menu,
where the user can select the built-in server if needed. A bb Connect
`unauthorized` error has no **Try again**, because the same credential fails
the same way. **Reconnect** opens account sign-in in a desktop
window. The app clears its old account sign-in, waits for a new session, then
retries the selected server. A valid account session can mint and renew the
desktop session when a machine credential is rejected. Closing the sign-in
window leaves the error screen available. Fatal errors have no buttons. The renderer sends the chosen
action on `bb-desktop:startup-action`. The main process accepts only actions
from the error page that is currently loaded in an app window's main frame.
