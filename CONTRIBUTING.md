# Contributing

Thanks for helping improve Vrata Desktop.

## Before You Open A Pull Request

A pull request from outside the bb team must meet all of these:

1. **Approved author.** You are on `.github/APPROVED_CONTRIBUTORS`. See [Contributor Approval](#contributor-approval).
2. **Linked issue.** The description closes an open issue in this repo, for example `Fixes #123`. See [Linked Issue](#linked-issue).
3. **Maintainer edits.** You opened it from your fork with "Allow edits by maintainers" turned on. GitHub offers the setting only on forks owned by a personal account; the gate does not check forks owned by an organization.

The PR gate closes a pull request that misses any of these and comments with what is missing. A closed pull request is not a review of the change.

## Contributor Approval

bb approves new contributors before it reviews their pull requests. Anyone can open an issue. You need no approval for an issue.

1. Open an issue for the change, or find an existing one. Feature requests and UI changes need sign-off first; see below.
2. Open the pull request with `Fixes #<number>` in its description. The gate closes it because you are not approved yet. That is expected.
3. Join the #contributors channel in Discord ([invite link](https://discord.gg/kvBU6tJhcJ)), post a link to the closed pull request, and explain what it changes and why.

A maintainer then adds your name to `.github/APPROVED_CONTRIBUTORS` and reopens the pull request. Authors with a merged change in main already have approval.

A maintainer can also approve you with `/approve @your-name` on the pull request.

## Linked Issue

Every pull request from outside the bb team must close an open issue in this repo.

A pull request is one attempt at a change, and many attempts do not land as written. We may ask for rework, a pull request closes after two weeks open, or we may solve the problem another way. The issue records the problem itself, so it stays visible and tracked whatever happens to any one pull request.

Write `Fixes #<number>`, `Closes #<number>`, or `Resolves #<number>` in the pull request description. A mention without one of these words does not count.

If the gate closes your pull request only because it has no linked issue, add the line to the description and save it. The pull request reopens on its own.

A maintainer can exempt a pull request from this requirement by adding the `skip-issue-check` label. The gate then reopens it if it meets the other requirements.

## Bugs

If you run into a bug, open an issue with the bug report form. Follow [docs/filing-issues.md](docs/filing-issues.md): versions, minimal copy-pasteable steps, expected vs actual output, evidence, and what you ruled out. A stranger should be able to reproduce it from the issue alone.

If you fix the bug, open a pull request that links the issue as described above.

## Feature Requests And UI Changes

For feature requests and UI changes, open an issue and wait for a maintainer's sign-off before you open a pull request.

Feel free to link changes from your fork as prototypes on the issue, but do not open a pull request against this repo until we are aligned on the feature.

## Updating from upstream

`origin` is `https://github.com/vrata-tg/vrata-desktop.git`; `upstream` is
`https://github.com/get-bb/bb.git`. Add upstream once, then create an update
branch from the current product `main`:

```bash
git remote add upstream https://github.com/get-bb/bb.git
git switch main
git pull --ff-only origin main
git switch -c update/bb-main
git fetch upstream
git merge upstream/main
```

If `upstream` already exists, check it with `git remote -v`. Resolve merge
conflicts by editing the affected files and reviewing both sides, then use
`git add <resolved-files>` and `git merge --continue`. Use `git merge --abort`
to abandon an unresolved merge. Run relevant Turbo tests/typechecks and review
the resulting diff. Merge the update PR with a merge commit that retains
ancestry; do not squash or rebase upstream-update PRs. The selected upstream
commit must remain an ancestor of product `main` after merging.

Review the host-daemon protocol version after merging. Vrata's server-move
commands operate on `~/.vrata-bb`; an upstream daemon that still selects `~/.bb`
must be rejected by the existing protocol gate and updated before use.

Before merging the update or enabling Actions, review every new/changed
`.github/workflows/` file. Disable inherited npm publishing, stable/nightly
desktop publishing and deploy workflows in this fork's Actions settings.
The inherited paths to disable include:

- `publish-bb-app.yml` and `build-desktop.yml` for npm and upstream desktop releases.
- `deploy-ai-gateway.yml`, `deploy-connect.yml`, `deploy-connect-next.yml`,
  `deploy-demo-server.yml` and `deploy-web.yml` for deployment.
- `mobile-ios-eas.yml` and `mobile-android-eas.yml` for mobile submission and
  release publication.

Repeat this review after every upstream merge and disable newly introduced
publishing paths before merging or re-enabling Actions. A workflow absent from
the Actions registration list still needs review when it is registered from the
default branch. Repository settings are a separate operator action; changing
these docs does not disable workflows. Only `vrata-desktop.yml` is the Vrata
Desktop release path. Ordinary source merges replace the former overlay and
automated upstream update machinery.

## Updating the bundled Vrata plugin

Keep plugin source in `vrata-tg/vrata-bb-plugin`. Publish a compatible plugin
there first, then manually change the exact `@vrata-ai/bb-plugin` dependency in
`plugins/vrata/package.json` and update the ordinary `pnpm-lock.yaml` using pnpm.
Review the exact version, package integrity and compatibility with the current
Plugin SDK; run adapter/runtime integration checks through Turbo. The adapter
stages the published package for bundling. Do not copy plugin source into this
repository or add dependency patches. Releases use the committed pin and never
fetch a latest plugin version.

Keep Desktop and `bb-app` at the same plain SemVer in their package manifests.
The Plugin SDK version is independent. Follow the manual dry-run, artifact
review and public-release sequence in
[the desktop release guide](apps/desktop/README.md#releasing).
