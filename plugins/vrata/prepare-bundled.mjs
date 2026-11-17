import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_SDK_MAJOR } from "@bb/domain";
import {
  buildPluginApp,
  buildPluginServer,
  copyPluginRuntime,
  resolvePluginBuildToolchain,
} from "@bb/plugin-build";

export async function readPublishedHost(sourceRoot, version) {
  const bytes = await readFile(join(sourceRoot, "dist/host.js"));
  const metadataBytes = await readFile(join(sourceRoot, "dist/host.meta.json"));
  const meta = JSON.parse(metadataBytes);
  assert.equal(
    meta.artifactFormatVersion,
    1,
    "Unsupported published host artifact format",
  );
  assert.equal(
    meta.sdkMajor,
    PLUGIN_SDK_MAJOR,
    "Published host requires another SDK major",
  );
  assert.equal(
    meta.pluginId,
    "bb-plugin",
    "Published host has another plugin ID",
  );
  assert.equal(
    meta.pluginVersion,
    version,
    "Published host version does not match npm pin",
  );
  assert.equal(
    meta.artifactDigest,
    createHash("sha256").update(bytes).digest("hex"),
    "Published host digest mismatch",
  );
  return { bytes, metadataBytes };
}

async function prepareBundledPlugin() {
  const adapterRoot = dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = resolve(adapterRoot, "../..");
  const require = createRequire(import.meta.url);
  const sourceRoot = dirname(
    require.resolve("@vrata-ai/bb-plugin/package.json"),
  );
  const adapterManifest = JSON.parse(
    await readFile(join(adapterRoot, "package.json"), "utf8"),
  );
  const manifest = JSON.parse(
    await readFile(join(sourceRoot, "package.json"), "utf8"),
  );
  const pin = adapterManifest.dependencies["@vrata-ai/bb-plugin"];
  assert.match(pin, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(manifest.name, "@vrata-ai/bb-plugin");
  assert.equal(
    manifest.version,
    pin,
    "Installed plugin does not match npm pin",
  );
  const host = await readPublishedHost(sourceRoot, pin);
  const bb = JSON.parse(
    await readFile(
      join(repositoryRoot, "packages/bb-app/package.json"),
      "utf8",
    ),
  );
  const stage = await mkdtemp(
    join(repositoryRoot, "plugins/.bundled-stage-vrata-"),
  );
  try {
    await cp(sourceRoot, stage, {
      recursive: true,
      filter: (entry) =>
        !["node_modules", "dist"].includes(
          relative(sourceRoot, entry).split(sep)[0],
        ),
    });
    await writeFile(
      join(stage, "package.json"),
      `${JSON.stringify({ ...manifest, vrataDistribution: "vrata-bb" }, null, 2)}\n`,
    );
    await symlink(
      await realpath(join(adapterRoot, "node_modules")),
      join(stage, "node_modules"),
      "junction",
    );
    const toolchain = await resolvePluginBuildToolchain(
      join(repositoryRoot, "packages/plugin-build/node_modules/.bb-toolchain"),
    );
    await buildPluginServer(stage, bb.version, toolchain, {
      hostProvidedZod: true,
    });
    await buildPluginApp(stage, bb.version, toolchain, {
      minify: true,
      hostProvidedZod: true,
    });
    await mkdir(join(stage, "dist"), { recursive: true });
    await writeFile(join(stage, "dist/host.js"), host.bytes);
    await writeFile(join(stage, "dist/host.meta.json"), host.metadataBytes);
    const targetDir = join(adapterRoot, ".bundled-runtime");
    await copyPluginRuntime({ sourceRoot: stage, targetDir });
    await cp(join(sourceRoot, "packaging"), join(targetDir, "packaging"), {
      recursive: true,
    });
    const runtimeManifestPath = join(targetDir, "package.json");
    const runtimeManifest = JSON.parse(
      await readFile(runtimeManifestPath, "utf8"),
    );
    await writeFile(
      runtimeManifestPath,
      `${JSON.stringify({ ...runtimeManifest, vrataDistribution: "vrata-bb" }, null, 2)}\n`,
    );
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await prepareBundledPlugin();
