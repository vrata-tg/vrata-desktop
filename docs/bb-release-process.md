# Releasing Vrata Desktop

Follow [the desktop release guide](../apps/desktop/README.md#releasing).
`vrata-desktop.yml` builds and verifies macOS, Linux and Windows installers;
publication requires a manual run on `main` with `publish=true`. Keep Desktop
and `bb-app` on the same plain SemVer and use the committed exact plugin pin.

This fork does not publish the upstream `bb-app` npm package or nightly/mobile
releases. Its inherited publishing workflows have been removed. The bundled
Vrata plugin is released separately from `vrata-tg/vrata-bb-plugin` before its
version is pinned here; see [CONTRIBUTING.md](../CONTRIBUTING.md#updating-the-bundled-vrata-plugin).

The [original upstream runbook](https://github.com/get-bb/bb/blob/1320c88e8abdd3f145bc9a5c305eace269fb2f28/docs/bb-release-process.md)
is retained as historical reference and does not describe releases from this fork.
