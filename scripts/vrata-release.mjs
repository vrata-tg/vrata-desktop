import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const desktopRequire = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
);
const { parse: parseYaml, stringify: stringifyYaml } = desktopRequire("yaml");
const semver = desktopRequire("semver");
const repository = "vrata-tg/vrata-desktop";
const upstreamVersion = "0.49.0";
const upstreamSha = "1320c88e8abdd3f145bc9a5c305eace269fb2f28";
const feeds = [
  ["macos", "desktop-version.json", "latest-mac.yml", "arm64", ["dmg", "zip"]],
  [
    "linux",
    "desktop-version-linux.json",
    "latest-linux.yml",
    "x86_64",
    ["AppImage"],
  ],
  ["windows", "desktop-version-windows.json", "latest.yml", "x64", ["exe"]],
];
const signingKeys = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

function plainVersion(value, label) {
  assert.equal(typeof value, "string", `${label} must be plain SemVer`);
  assert.match(
    value,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    `${label} must be plain SemVer`,
  );
  assert.equal(semver.valid(value), value, `${label} must be plain SemVer`);
  return value;
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function readReleaseConfig(directory = root) {
  const desktop = await json(resolve(directory, "apps/desktop/package.json"));
  const app = await json(resolve(directory, "packages/bb-app/package.json"));
  const plugin = await json(resolve(directory, "plugins/vrata/package.json"));
  const sdk = await json(
    resolve(directory, "packages/plugin-sdk/package.json"),
  );
  const version = plainVersion(desktop.version, "Desktop version");
  plainVersion(app.version, "bb-app version");
  assert.equal(app.version, version, "Desktop and bb-app versions must match");
  assert.equal(
    sdk.version,
    "0.6.149",
    "Plugin SDK version must stay independent at 0.6.149",
  );
  const pluginVersion = plugin.dependencies?.["@vrata-ai/bb-plugin"];
  plainVersion(pluginVersion, "Plugin pin");
  return { version, pluginVersion };
}

export function assertPublishContext(environment) {
  assert.equal(
    environment.GITHUB_REPOSITORY,
    repository,
    "Publish repository mismatch",
  );
  assert.equal(
    environment.GITHUB_EVENT_NAME,
    "workflow_dispatch",
    "Publish requires workflow_dispatch",
  );
  assert.equal(
    environment.GITHUB_REF,
    "refs/heads/main",
    "Publish only from main",
  );
  assert.equal(environment.VRATA_PUBLISH, "true", "Publish input must be true");
  assert.match(
    environment.GITHUB_SHA ?? "",
    /^[a-f0-9]{40}$/,
    "Publish requires event SHA",
  );
}

export function validateSigningEnvironment(environment, publish) {
  const missing = signingKeys.filter((key) => !environment[key]?.trim());
  assert(
    missing.length === 0 || (!publish && missing.length === signingKeys.length),
    `Incomplete macOS signing/notarization environment. Missing: ${missing.join(", ")}`,
  );
  return missing.length === 0 ? "signed" : "unsigned";
}

async function digest(
  directory,
  name,
  algorithm = "sha512",
  encoding = "base64",
) {
  const path = resolve(directory, name);
  const stat = await lstat(path);
  assert(
    stat.isFile() && stat.size > 0,
    `Asset must be a nonempty regular file: ${name}`,
  );
  const hash = createHash(algorithm);
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return { size: stat.size, hash: hash.digest(encoding) };
}

export async function recordSigning(directory, config, environment) {
  validateSigningEnvironment(environment, true);
  assert.equal(environment.GITHUB_EVENT_NAME, "workflow_dispatch");
  assert.equal(environment.GITHUB_REF, "refs/heads/main");
  assert.equal(environment.GITHUB_REPOSITORY, repository);
  assert.match(environment.GITHUB_SHA ?? "", /^[a-f0-9]{40}$/);
  const artifacts = {};
  for (const extension of ["dmg", "zip"]) {
    const name = `vrata-bb-${config.version}-arm64.${extension}`;
    artifacts[name] = (await digest(directory, name)).hash;
  }
  await writeFile(
    resolve(directory, "macos-signing.json"),
    `${JSON.stringify({ schemaVersion: 1, version: config.version, sha: environment.GITHUB_SHA, signed: true, notarized: true, artifacts }, null, 2)}\n`,
  );
}

async function verifySigning(directory, config, environment) {
  let evidence;
  try {
    evidence = await json(resolve(directory, "macos-signing.json"));
  } catch {
    throw new Error("Missing macOS signing/notarization evidence");
  }
  assert.equal(evidence.schemaVersion, 1, "Invalid signing evidence schema");
  assert.equal(
    evidence.version,
    config.version,
    "Signing evidence version mismatch",
  );
  assert.equal(
    evidence.sha,
    environment.GITHUB_SHA,
    "Signing evidence SHA mismatch",
  );
  assert.equal(evidence.signed, true, "Unsigned macOS release");
  assert.equal(evidence.notarized, true, "Missing macOS notarization");
  for (const extension of ["dmg", "zip"]) {
    const name = `vrata-bb-${config.version}-arm64.${extension}`;
    assert.equal(
      evidence.artifacts?.[name],
      (await digest(directory, name)).hash,
      `Signing evidence checksum mismatch: ${name}`,
    );
  }
}

export async function prepareRelease(directory, config) {
  const version = plainVersion(config.version, "Release version");
  plainVersion(config.pluginVersion, "Plugin pin");
  const tag = `vrata-v${version}`;
  const base = `https://github.com/${repository}/releases/download/${tag}/`;
  const assets = new Set();
  const outputs = new Map();
  const downloads = [];
  for (const [platform, jsonName, yamlName, arch, extensions] of feeds) {
    const feed = await json(resolve(directory, jsonName));
    const update = parseYaml(
      await readFile(resolve(directory, yamlName), "utf8"),
    );
    const expected = extensions.map(
      (extension) => `vrata-bb-${version}-${arch}.${extension}`,
    );
    const validate = async (metadata, label, isJson) => {
      assert(
        metadata && typeof metadata === "object",
        `Invalid metadata: ${label}`,
      );
      assert.equal(metadata.version, version, `Version mismatch: ${label}`);
      if (isJson || metadata.platform !== undefined)
        assert.equal(
          metadata.platform,
          platform,
          `Platform mismatch: ${label}`,
        );
      if (isJson || metadata.channel !== undefined)
        assert.equal(metadata.channel, "latest", `Channel mismatch: ${label}`);
      if (isJson)
        assert.equal(metadata.schemaVersion, 1, `Schema mismatch: ${label}`);
      assert(
        Array.isArray(metadata.files) && metadata.files.length > 0,
        `Missing files: ${label}`,
      );
      const nameOf = (url) => {
        assert.equal(typeof url, "string", `Invalid installer URL: ${label}`);
        const name = url.startsWith(base) ? url.slice(base.length) : url;
        assert(
          expected.includes(name),
          `Unexpected installer version/platform/architecture: ${url}`,
        );
        return name;
      };
      const seen = new Set();
      for (const file of metadata.files) {
        const name = nameOf(file.url);
        assert(!seen.has(name), `Duplicate installer: ${label} ${name}`);
        seen.add(name);
        const actual = await digest(directory, name);
        assert.equal(file.size, actual.size, `Size mismatch: ${label} ${name}`);
        assert.equal(
          file.sha512,
          actual.hash,
          `Checksum mismatch: ${label} ${name}`,
        );
        file.url = `${base}${name}`;
      }
      for (const name of expected)
        assert(seen.has(name), `Missing installer: ${label} ${name}`);
      const primaryName = nameOf(metadata.path);
      const primary = metadata.files.find(
        (file) => file.url === `${base}${primaryName}`,
      );
      assert.equal(
        metadata.sha512,
        primary.sha512,
        `Primary checksum mismatch: ${label}`,
      );
      metadata.path = `${base}${primaryName}`;
      return metadata;
    };
    await validate(feed, jsonName, true);
    await validate(update, yamlName, false);
    const ordered = (files) =>
      files
        .map(({ url, size, sha512 }) => ({ url, size, sha512 }))
        .sort((a, b) => a.url.localeCompare(b.url));
    assert.deepEqual(
      ordered(feed.files),
      ordered(update.files),
      `JSON/YAML files mismatch: ${platform}`,
    );
    for (const key of ["path", "sha512", "releaseDate"])
      assert.equal(
        feed[key],
        update[key],
        `JSON/YAML ${key} mismatch: ${platform}`,
      );
    assert.equal(
      typeof feed.releaseDate,
      "string",
      `Invalid releaseDate: ${platform}`,
    );
    assert(
      Number.isFinite(Date.parse(feed.releaseDate)),
      `Invalid releaseDate: ${platform}`,
    );
    outputs.set(jsonName, `${JSON.stringify(feed, null, 2)}\n`);
    outputs.set(yamlName, stringifyYaml(update));
    expected.forEach((name) => assets.add(name));
    assets.add(jsonName);
    assets.add(yamlName);
    for (const name of expected)
      downloads.push(
        `| ${platform === "macos" ? "macOS" : platform === "linux" ? "Linux" : "Windows"} | ${arch} | [${name}](${base}${name}) |`,
      );
  }
  for (const name of await readdir(directory)) {
    if (name.endsWith(".blockmap")) {
      assert(assets.has(name.slice(0, -9)), `Orphan blockmap: ${name}`);
      await digest(directory, name);
      assets.add(name);
    }
  }
  try {
    await lstat(resolve(directory, "macos-signing.json"));
    assets.add("macos-signing.json");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [name, content] of outputs)
    await writeFile(resolve(directory, name), content);
  const hashes = {};
  const checksums = [];
  for (const name of [...assets].sort()) {
    const actual = await digest(directory, name, "sha256", "hex");
    hashes[name] = actual;
    checksums.push(`${actual.hash}  ${name}`);
  }
  await writeFile(
    resolve(directory, "SHA256SUMS"),
    `${checksums.join("\n")}\n`,
  );
  assets.add("SHA256SUMS");
  hashes.SHA256SUMS = await digest(directory, "SHA256SUMS", "sha256", "hex");
  const notes = [
    `Vrata Desktop ${version}`,
    "",
    `BB upstream ${upstreamVersion}; original upstream SHA ${upstreamSha}.`,
    `Bundled @vrata-ai/bb-plugin exact pin: ${config.pluginVersion}.`,
    "",
    "| Platform | Architecture | Download |",
    "| --- | --- | --- |",
    ...downloads,
    "",
    `[SHA-256 checksums](${base}SHA256SUMS) cover installers, updater feeds and generated blockmaps.`,
    "",
    "First move from the old Vrata: manually download and install Vrata Desktop. Close the old application first. On macOS, remove only the old .app bundle and place Vrata Desktop.app in Applications. Preserve the .vrata-bb profile and credentials; do not delete application data. Old installations still use the old repository feed. Future updates use the existing desktop updater between new Vrata Desktop versions.",
    "",
  ].join("\n");
  return { tag, assets: [...assets].sort(), hashes, notes };
}

export function assertLatestVersion(version, latest) {
  if (latest === null) return;
  assert.equal(latest.draft, false, "Latest must be published");
  assert.equal(latest.prerelease, false, "Latest must be stable");
  const current = latest.tag_name?.startsWith("vrata-v")
    ? latest.tag_name.slice(7)
    : "";
  plainVersion(current, "Latest version");
  assert(
    semver.gt(version, current),
    `Candidate ${version} must be strictly newer than published Latest ${current}`,
  );
}

async function runGh(args, options = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    if (/\bHTTP 404\b/.test(String(error.stderr))) error.httpStatus = 404;
    throw error;
  }
}

export async function publishRelease(
  directory,
  config,
  result,
  environment,
  gh = runGh,
) {
  assertPublishContext(environment);
  await verifySigning(directory, config, environment);
  const notes = `${result.notes}\nSource SHA: ${environment.GITHUB_SHA}.\n`;
  const api = async (path, method = "GET", body) => {
    const args = ["api", `repos/${repository}/${path}`];
    if (method !== "GET") args.push("--method", method, "--input", "-");
    return JSON.parse(
      await gh(args, body === undefined ? {} : { input: JSON.stringify(body) }),
    );
  };
  const optional = async (path) => {
    try {
      return await api(path);
    } catch (error) {
      if (error.httpStatus === 404) return null;
      throw error;
    }
  };
  const checkTag = async () => {
    const ref = await optional(`git/ref/tags/${result.tag}`);
    if (!ref) return false;
    let object = ref.object;
    const seen = new Set();
    while (object.type === "tag") {
      assert(!seen.has(object.sha), "Invalid recursive release tag");
      seen.add(object.sha);
      object = (await api(`git/tags/${object.sha}`)).object;
    }
    assert.equal(object.type, "commit", "Release tag must reference a commit");
    assert.equal(
      object.sha,
      environment.GITHUB_SHA,
      "Release tag SHA mismatch",
    );
    return true;
  };
  const assertDraft = (release) => {
    assert.equal(release.draft, true, "Version is already published");
    assert.equal(release.prerelease, false, "Foreign draft prerelease");
    assert.equal(release.tag_name, result.tag, "Foreign draft tag");
    assert.equal(
      release.target_commitish,
      environment.GITHUB_SHA,
      "Foreign draft SHA",
    );
    assert.equal(
      release.name,
      `Vrata Desktop ${config.version}`,
      "Foreign draft title",
    );
    assert.equal(release.body, notes, "Foreign draft provenance");
    assert(Number.isSafeInteger(release.id), "Invalid draft ID");
  };
  let release = await optional(`releases/tags/${result.tag}`);
  if (!release) {
    const pages = JSON.parse(
      await gh([
        "api",
        `repos/${repository}/releases?per_page=100`,
        "--paginate",
        "--slurp",
      ]),
    );
    assert(
      Array.isArray(pages) && pages.every(Array.isArray),
      "Invalid release listing",
    );
    const matches = pages
      .flat()
      .filter((candidate) => candidate.tag_name === result.tag);
    assert(matches.length <= 1, "Multiple drafts use the release tag");
    release = matches[0] ?? null;
  }
  const tagExists = await checkTag();
  if (release) assertDraft(release);
  else {
    assert.equal(
      tagExists,
      false,
      "Release tag already exists without resumable draft",
    );
    release = await api("releases", "POST", {
      tag_name: result.tag,
      target_commitish: environment.GITHUB_SHA,
      name: `Vrata Desktop ${config.version}`,
      body: notes,
      draft: true,
      prerelease: false,
      make_latest: "false",
    });
    assertDraft(release);
  }
  const listAssets = async () => {
    const remoteAssets = await api(
      `releases/${release.id}/assets?per_page=100`,
    );
    assert(Array.isArray(remoteAssets), "Invalid draft assets");
    const names = new Set();
    for (const asset of remoteAssets) {
      assert(
        result.assets.includes(asset.name) && !names.has(asset.name),
        `Unexpected draft asset: ${asset.name}`,
      );
      assert.equal(
        asset.size,
        result.hashes[asset.name].size,
        `Draft asset size mismatch: ${asset.name}`,
      );
      names.add(asset.name);
    }
    return names;
  };
  const existing = await listAssets();
  const missing = result.assets.filter((name) => !existing.has(name));
  if (missing.length)
    await gh([
      "release",
      "upload",
      result.tag,
      ...missing.map((name) => resolve(directory, name)),
      "--repo",
      repository,
    ]);
  const uploaded = await listAssets();
  assert.equal(uploaded.size, result.assets.length, "Missing draft assets");
  const downloaded = await mkdtemp(resolve(tmpdir(), "vrata-draft-"));
  try {
    await gh([
      "release",
      "download",
      result.tag,
      "--repo",
      repository,
      "--dir",
      downloaded,
    ]);
    assert.deepEqual(
      (await readdir(downloaded)).sort(),
      result.assets,
      "Downloaded draft asset set mismatch",
    );
    for (const name of result.assets) {
      assert.deepEqual(
        await digest(downloaded, name, "sha256", "hex"),
        result.hashes[name],
        `Draft asset checksum mismatch: ${name}`,
      );
    }
  } finally {
    await rm(downloaded, { recursive: true, force: true });
  }
  assertDraft(await api(`releases/${release.id}`));
  await checkTag();
  const finalAssets = await listAssets();
  assert.equal(
    finalAssets.size,
    result.assets.length,
    "Draft asset set changed before promotion",
  );
  assertLatestVersion(config.version, await optional("releases/latest"));
  await api(`releases/${release.id}`, "PATCH", {
    draft: false,
    prerelease: false,
    make_latest: "true",
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--check-signing")) {
    if (process.env.VRATA_PUBLISH === "true") assertPublishContext(process.env);
    console.log(
      validateSigningEnvironment(
        process.env,
        process.env.VRATA_PUBLISH === "true",
      ),
    );
    return;
  }
  const config = await readReleaseConfig();
  if (args.includes("--check-config")) {
    console.log(JSON.stringify(config));
    return;
  }
  const directory = resolve(
    args.find((arg) => !arg.startsWith("--")) ?? "apps/desktop/release",
  );
  if (args.includes("--record-signing")) {
    await recordSigning(directory, config, process.env);
    return;
  }
  const result = await prepareRelease(directory, config);
  if (args.includes("--publish"))
    await publishRelease(directory, config, result, process.env);
  console.log(
    JSON.stringify({
      version: config.version,
      tag: result.tag,
      assets: result.assets,
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
