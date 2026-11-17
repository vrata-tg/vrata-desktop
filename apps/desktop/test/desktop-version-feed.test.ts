import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { parse, stringify } from "yaml";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

async function bundleGenerator(root: string, platform: string): Promise<string> {
  const script = join(root, "generate.mjs");
  await build({
    entryPoints: [resolve("scripts/generate-version-feed.mts")],
    outfile: script,
    bundle: true,
    platform: "node",
    format: "esm",
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    define: { "process.platform": JSON.stringify(platform) },
  });
  return script;
}

describe("desktop release compatibility metadata", () => {
  it.each([
    {
      platform: "darwin",
      feedPlatform: "macos",
      metadataName: "latest-mac.yml",
      feedName: "desktop-version.json",
      minimum: "22.0.0",
    },
    {
      platform: "linux",
      feedPlatform: "linux",
      metadataName: "latest-linux.yml",
      feedName: "desktop-version-linux.json",
      minimum: null,
    },
    {
      platform: "win32",
      feedPlatform: "windows",
      metadataName: "latest.yml",
      feedName: "desktop-version-windows.json",
      minimum: null,
    },
  ])(
    "publishes the OS requirement for $platform latest without losing update fields",
    async ({ platform, feedPlatform, metadataName, feedName, minimum }) => {
      const root = await mkdtemp(join(tmpdir(), "bb-version-feed-test-"));
      try {
        const release = join(root, "release");
        await mkdir(release);
        await writeFile(join(root, "package.json"), '{"version":"0.43.1"}');
        const metadata = {
          version: "0.43.1",
          files: [
            { url: "bb.zip", sha512: "checksum", size: 123, blockMapSize: 42 },
          ],
          path: "bb.zip",
          sha512: "checksum",
          releaseDate: "2026-09-15T00:00:00.000Z",
          stagingPercentage: 25,
          releaseNotes: "Preserve the upstream release notes",
        };
        const metadataPath = join(release, metadataName);
        await writeFile(metadataPath, stringify(metadata));
        const script = await bundleGenerator(root, platform);
        await execFileAsync(process.execPath, [script], {
          cwd: root,
          env: { ...process.env, BB_DESKTOP_RELEASE_CHANNEL: "latest" },
        });
        const updated: unknown = parse(await readFile(metadataPath, "utf8"));
        expect(updated).toEqual(
          minimum === null
            ? metadata
            : { ...metadata, minimumSystemVersion: minimum },
        );
        const feed: unknown = JSON.parse(
          await readFile(join(release, feedName), "utf8"),
        );
        expect(feed).toMatchObject({
          channel: "latest",
          platform: feedPlatform,
          releaseName: `Vrata Desktop ${metadata.version}`,
          minimumSystemVersion: minimum,
          files: [{ url: "bb.zip", sha512: "checksum", size: 123 }],
          version: metadata.version,
        });
        if (platform === "darwin") {
          const config: unknown = JSON.parse(
            await readFile(resolve("electron-builder.config.json"), "utf8"),
          );
          expect(config).toMatchObject({
            mac: { minimumSystemVersion: "13.0.0" },
          });
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("rejects the unsupported nightly channel", async () => {
    const root = await mkdtemp(join(tmpdir(), "bb-version-feed-test-"));
    try {
      const script = await bundleGenerator(root, "darwin");
      await expect(
        execFileAsync(process.execPath, [script], {
          cwd: root,
          env: { ...process.env, BB_DESKTOP_RELEASE_CHANNEL: "nightly" },
        }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "BB_DESKTOP_RELEASE_CHANNEL must be latest, got nightly.",
        ),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
