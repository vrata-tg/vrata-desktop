# Contributing

Thanks for helping improve Vrata Desktop.

Describe the change and relevant verification in ordinary prose. Pull requests
have no fixed template, required headings, footer, linked-issue requirement or
contributor allowlist. Link issues or evidence when they help the reviewer.

For bug reports, follow [docs/filing-issues.md](docs/filing-issues.md) so someone
else can reproduce the problem.

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

Review every new or changed `.github/workflows/` file after each upstream
merge. Keep only the workflows used by this fork:

- `vrata-desktop.yml` builds and verifies the three desktop platforms on pull
  requests and manual runs. Publishing requires an explicit manual run on `main`.
- `version-lockstep.yml` checks Desktop/`bb-app` versions and Plugin SDK version
  changes on GitHub-hosted Ubuntu runners.

Remove unrelated upstream CI, contributor gates, scheduled maintenance, npm
publishing, mobile releases and service deployments before merging the update.
There is no scheduled release or automatic upstream/plugin synchronization.
Ordinary Git merges replace the former overlay machinery.

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
