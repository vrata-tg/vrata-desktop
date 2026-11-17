import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assertLatestVersion,
  assertPublishContext,
  prepareRelease,
  publishRelease,
  readReleaseConfig,
  recordSigning,
  validateSigningEnvironment,
} from "./vrata-release.mjs";

const { parse, stringify } = createRequire(
  new URL("../apps/desktop/package.json", import.meta.url),
)("yaml");
const sha = "a".repeat(40);
const config = { version: "1.0.0", pluginVersion: "0.2.0" };
const environment = {
  GITHUB_REPOSITORY: "vrata-tg/vrata-desktop",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_SHA: sha,
  VRATA_PUBLISH: "true",
};
const signing = Object.fromEntries(
  [
    "CSC_LINK",
    "CSC_KEY_PASSWORD",
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ].map((key) => [key, "test-value"]),
);
const platforms = [
  [
    "macos",
    "desktop-version.json",
    "latest-mac.yml",
    ["arm64.dmg", "arm64.zip"],
  ],
  [
    "linux",
    "desktop-version-linux.json",
    "latest-linux.yml",
    ["x86_64.AppImage"],
  ],
  ["windows", "desktop-version-windows.json", "latest.yml", ["x64.exe"]],
];

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-release-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [platform, json, yaml, suffixes] of platforms) {
    const files = [];
    for (const suffix of suffixes) {
      const name = `vrata-bb-1.0.0-${suffix}`;
      const bytes = Buffer.from(`installer-${suffix}`);
      await writeFile(resolve(root, name), bytes);
      await writeFile(resolve(root, `${name}.blockmap`), `blockmap-${suffix}`);
      files.push({
        url: name,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      });
    }
    const feed = {
      schemaVersion: 1,
      version: "1.0.0",
      platform,
      channel: "latest",
      files,
      path: files[0].url,
      sha512: files[0].sha512,
      releaseDate: "2026-11-17T00:00:00Z",
      releaseName: "Vrata Desktop 1.0.0",
      releaseNotes: null,
      minimumSystemVersion: platform === "macos" ? "22.0.0" : null,
      stagingPercentage: null,
    };
    await writeFile(resolve(root, json), JSON.stringify(feed));
    const update = { ...feed };
    if (platform === "linux")
      update.files = files.map((file) => ({ ...file, blockMapSize: 200837 }));
    for (const key of ["schemaVersion", "platform", "channel"])
      delete update[key];
    await writeFile(resolve(root, yaml), stringify(update));
  }
  return root;
}

async function mutate(root, name, change) {
  const path = resolve(root, name);
  const value = name.endsWith(".json")
    ? JSON.parse(await readFile(path, "utf8"))
    : parse(await readFile(path, "utf8"));
  change(value);
  await writeFile(
    path,
    name.endsWith(".json") ? JSON.stringify(value) : stringify(value),
  );
}

void test("all feeds become immutable, blockmaps survive, checksums include metadata, and preparation is repeatable", async (t) => {
  const root = await fixture(t);
  const before = await readFile(
    resolve(root, "vrata-bb-1.0.0-arm64.zip.blockmap"),
  );
  const result = await prepareRelease(root, config);
  assert.equal(result.tag, "vrata-v1.0.0");
  assert.equal(result.assets.length, 15);
  assert(result.assets.includes("vrata-bb-1.0.0-x86_64.AppImage"));
  assert(!result.assets.includes("vrata-bb-1.0.0-x64.AppImage"));
  assert.deepEqual(await prepareRelease(root, config), result);
  for (const [platform, json, yaml] of platforms) {
    const feed = JSON.parse(await readFile(resolve(root, json), "utf8"));
    const update = parse(await readFile(resolve(root, yaml), "utf8"));
    assert.deepEqual(
      feed.files,
      update.files.map(({ url, size, sha512 }) => ({ url, size, sha512 })),
    );
    if (platform === "linux") {
      assert.equal(update.files[0].blockMapSize, 200837);
      assert(feed.path.endsWith("vrata-bb-1.0.0-x86_64.AppImage"));
    }
    assert.equal(feed.path, update.path);
    assert(
      feed.path.startsWith(
        "https://github.com/vrata-tg/vrata-desktop/releases/download/vrata-v1.0.0/",
      ),
    );
  }
  assert.deepEqual(
    await readFile(resolve(root, "vrata-bb-1.0.0-arm64.zip.blockmap")),
    before,
  );
  const checksums = await readFile(resolve(root, "SHA256SUMS"), "utf8");
  assert(checksums.includes("latest-mac.yml"));
  assert(checksums.includes("desktop-version-windows.json"));
  assert(result.notes.includes("0.49.0"));
  assert(result.notes.includes("1320c88e8"));
  assert(result.notes.includes("0.2.0"));
  assert(result.notes.includes(".vrata-bb"));
  assert(!result.notes.includes("xattr"));
});

for (const [name, change, pattern] of [
  [
    "desktop-version.json",
    (f) => {
      f.version = "1.0.1";
    },
    /version/i,
  ],
  [
    "latest-linux.yml",
    (f) => {
      f.version = "1.0.1";
    },
    /version/i,
  ],
  [
    "desktop-version-windows.json",
    (f) => {
      f.platform = "linux";
    },
    /platform/i,
  ],
  [
    "latest.yml",
    (f) => {
      f.platform = "linux";
    },
    /platform/i,
  ],
  [
    "desktop-version-linux.json",
    (f) => {
      f.channel = "nightly";
    },
    /channel/i,
  ],
  [
    "latest-mac.yml",
    (f) => {
      f.channel = "nightly";
    },
    /channel/i,
  ],
  [
    "latest.yml",
    (f) => {
      f.files[0].size++;
    },
    /size/i,
  ],
  [
    "latest-mac.yml",
    (f) => {
      f.files[0].sha512 = "bad";
    },
    /checksum/i,
  ],
  [
    "desktop-version.json",
    (f) => {
      f.sha512 = "bad";
    },
    /primary/i,
  ],
  [
    "desktop-version.json",
    (f) => {
      f.files.pop();
    },
    /missing/i,
  ],
  [
    "latest.yml",
    (f) => {
      f.files.push(f.files[0]);
    },
    /duplicate/i,
  ],
  [
    "desktop-version-linux.json",
    (f) => {
      f.files[0].url = "vrata-bb-1.0.0-arm64.AppImage";
    },
    /installer/i,
  ],
  [
    "latest-linux.yml",
    (f) => {
      f.files[0].url = "vrata-bb-1.0.0-x64.AppImage";
    },
    /installer/i,
  ],
  [
    "latest.yml",
    (f) => {
      f.files[0].url = "https://example.org/vrata-bb-1.0.0-x64.exe";
    },
    /installer/i,
  ],
]) {
  void test(`rejects invalid ${name}: ${pattern}`, async (t) => {
    const root = await fixture(t);
    const before = await readFile(
      resolve(root, "desktop-version.json"),
      "utf8",
    );
    await mutate(root, name, change);
    const changed = await readFile(
      resolve(root, "desktop-version.json"),
      "utf8",
    );
    await assert.rejects(prepareRelease(root, config), pattern);
    assert.equal(
      await readFile(resolve(root, "desktop-version.json"), "utf8"),
      name === "desktop-version.json" ? changed : before,
    );
  });
}

void test("same-size corrupted bytes and missing platform prevent preparation", async (t) => {
  const root = await fixture(t);
  const name = resolve(root, "vrata-bb-1.0.0-x64.exe");
  const bytes = await readFile(name);
  await writeFile(name, Buffer.alloc(bytes.length));
  await assert.rejects(prepareRelease(root, config), /checksum/i);
  await rm(resolve(root, "desktop-version-windows.json"));
  await assert.rejects(prepareRelease(root, config), /ENOENT/);
});

void test("manifest versions are equal plain SemVer, plugin is exact, SDK stays independent", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "vrata-manifests-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifests = [
    ["apps/desktop", { version: "1.0.0" }],
    ["packages/bb-app", { version: "1.0.0" }],
    ["plugins/vrata", { dependencies: { "@vrata-ai/bb-plugin": "0.2.0" } }],
    ["packages/plugin-sdk", { version: "0.6.149" }],
  ];
  for (const [path, value] of manifests) {
    await mkdir(resolve(root, path), { recursive: true });
    await writeFile(resolve(root, path, "package.json"), JSON.stringify(value));
  }
  assert.deepEqual(await readReleaseConfig(root), config);
  for (const version of [
    "1.0.1",
    "1.0.0-r1",
    "v1.0.0",
    "01.0.0",
    "1.0.0+build",
    "1.0.0-beta.1",
  ]) {
    await writeFile(
      resolve(root, "packages/bb-app/package.json"),
      JSON.stringify({ version }),
    );
    await assert.rejects(readReleaseConfig(root), /version|SemVer/i);
  }
  await writeFile(
    resolve(root, "packages/bb-app/package.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  await writeFile(
    resolve(root, "plugins/vrata/package.json"),
    JSON.stringify({ dependencies: { "@vrata-ai/bb-plugin": "^0.2.0" } }),
  );
  await assert.rejects(readReleaseConfig(root), /pin/i);
});

void test("publication context and signing fail closed", () => {
  assert.doesNotThrow(() => assertPublishContext(environment));
  for (const [key, value] of [
    ["GITHUB_EVENT_NAME", "pull_request"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/tags/v1"],
    ["GITHUB_REF", "refs/heads/feature"],
    ["VRATA_PUBLISH", "false"],
    ["GITHUB_REPOSITORY", "get-bb/bb"],
    ["GITHUB_SHA", "main"],
  ]) {
    assert.throws(() => assertPublishContext({ ...environment, [key]: value }));
  }
  assert.equal(validateSigningEnvironment({}, false), "unsigned");
  assert.equal(validateSigningEnvironment(signing, true), "signed");
  assert.throws(() => validateSigningEnvironment({}, true), /signing/i);
  for (const key of Object.keys(signing))
    assert.throws(
      () => validateSigningEnvironment({ ...signing, [key]: " " }, false),
      /signing/i,
    );
});

function github(result, options = {}) {
  const remote = new Map();
  let release = options.release === undefined ? null : options.release;
  let promoted = false;
  let latestReads = 0;
  const calls = [];
  const notFound = () => {
    const error = new Error("HTTP 404");
    error.httpStatus = 404;
    throw error;
  };
  const run = async (args, commandOptions = {}) => {
    calls.push(args);
    if (args[0] === "release") {
      assert.equal(
        args[args.indexOf("--repo") + 1],
        environment.GITHUB_REPOSITORY,
      );
      if (args[1] === "upload") {
        assert(!args.includes("--clobber"));
        for (const path of args.slice(3, args.indexOf("--repo")))
          remote.set(path.split(/[\\/]/).at(-1), await readFile(path));
      } else if (args[1] === "download") {
        const directory = args[args.indexOf("--dir") + 1];
        for (const [name, bytes] of remote)
          await writeFile(
            resolve(directory, name),
            options.corrupt === name ? Buffer.from("corrupt") : bytes,
          );
      } else assert.fail(`Unexpected command ${args}`);
      return "";
    }
    assert(args[1].startsWith("repos/vrata-tg/vrata-desktop/"));
    const endpoint = args[1].split("/vrata-desktop/")[1];
    const method = args.includes("--method")
      ? args[args.indexOf("--method") + 1]
      : "GET";
    if (endpoint.startsWith("git/ref/tags/")) {
      if (options.tagSha)
        return JSON.stringify({
          object: { type: "commit", sha: options.tagSha },
        });
      return notFound();
    }
    if (endpoint === "releases/latest") {
      latestReads++;
      return options.latest ? JSON.stringify(options.latest) : notFound();
    }
    if (method === "POST" && endpoint === "releases") {
      assert.equal(release, null);
      release = { id: 42, ...JSON.parse(commandOptions.input) };
      assert(release.body.includes("\n\n"));
      assert(release.body.includes(`Source SHA: ${sha}.`));
      return JSON.stringify(release);
    }
    if (method === "PATCH") {
      assert.equal(remote.size, result.assets.length);
      assert.equal(latestReads, 1);
      promoted = true;
      return JSON.stringify({
        ...release,
        ...JSON.parse(commandOptions.input),
      });
    }
    if (endpoint.endsWith("/assets?per_page=100"))
      return JSON.stringify(
        [...remote].map(([name, bytes]) => ({ name, size: bytes.length })),
      );
    if (endpoint === "releases?per_page=100") {
      assert(args.includes("--paginate"));
      assert(args.includes("--slurp"));
      return JSON.stringify([[], release ? [release] : []]);
    }
    if (endpoint.startsWith("releases/tags/"))
      return release && !release.draft ? JSON.stringify(release) : notFound();
    if (endpoint === "releases/42")
      return release ? JSON.stringify(release) : notFound();
    assert.fail(`Unexpected endpoint ${endpoint}`);
  };
  return { run, remote, calls, published: () => promoted };
}

async function signedFixture(t) {
  const root = await fixture(t);
  await recordSigning(root, config, { ...environment, ...signing });
  return { root, result: await prepareRelease(root, config) };
}

void test("unsigned dry run passes but public release requires signing evidence bound to SHA and bytes", async (t) => {
  const root = await fixture(t);
  const result = await prepareRelease(root, config);
  await assert.rejects(
    publishRelease(root, config, result, environment, () =>
      assert.fail("No API writes"),
    ),
    /signing/i,
  );
  await recordSigning(root, config, { ...environment, ...signing });
  const signed = await prepareRelease(root, config);
  await assert.rejects(
    publishRelease(
      root,
      config,
      signed,
      { ...environment, GITHUB_SHA: "b".repeat(40) },
      () => assert.fail("No API writes"),
    ),
    /signing/i,
  );
});

void test("new draft uploads and verifies every downloaded asset before promotion", async (t) => {
  const { root, result } = await signedFixture(t);
  const gh = github(result);
  await publishRelease(root, config, result, environment, gh.run);
  assert(gh.published());
  assert.equal(gh.remote.size, result.assets.length);
});

for (const [label, options, pattern] of [
  ["published version", { release: { draft: false } }, /published/i],
  [
    "foreign draft",
    {
      release: {
        tag_name: "vrata-v1.0.0",
        draft: true,
        target_commitish: "b".repeat(40),
      },
    },
    /draft/i,
  ],
  ["wrong tag SHA", { tagSha: "b".repeat(40) }, /tag/i],
  ["existing orphan tag", { tagSha: sha }, /tag/i],
  ["corrupt remote metadata", { corrupt: "latest.yml" }, /asset|checksum/i],
  [
    "late older retry",
    { latest: { tag_name: "vrata-v1.0.1", draft: false, prerelease: false } },
    /Latest/i,
  ],
]) {
  void test(`rejects ${label} without promotion`, async (t) => {
    const { root, result } = await signedFixture(t);
    const gh = github(result, options);
    await assert.rejects(
      publishRelease(root, config, result, environment, gh.run),
      pattern,
    );
    assert(!gh.published());
  });
}

void test("same-version same-SHA draft resumes missing assets without clobber", async (t) => {
  const { root, result } = await signedFixture(t);
  const release = {
    id: 42,
    draft: true,
    prerelease: false,
    tag_name: result.tag,
    name: "Vrata Desktop 1.0.0",
    body: `${result.notes}\nSource SHA: ${sha}.\n`,
    target_commitish: sha,
  };
  const gh = github(result, { release, tagSha: sha });
  gh.remote.set(
    result.assets[0],
    await readFile(resolve(root, result.assets[0])),
  );
  await publishRelease(root, config, result, environment, gh.run);
  assert(gh.published());
  const upload = gh.calls.find((args) => args[1] === "upload");
  assert(!upload.includes(resolve(root, result.assets[0])));
});

void test("Latest guard uses numeric plain SemVer comparison", () => {
  assert.doesNotThrow(() =>
    assertLatestVersion("1.0.10", {
      tag_name: "vrata-v1.0.9",
      draft: false,
      prerelease: false,
    }),
  );
  for (const tag_name of [
    "vrata-v1.0.10",
    "vrata-v1.0.11",
    "desktop-latest",
    "vrata-v1.0.9-r1",
  ])
    assert.throws(
      () =>
        assertLatestVersion("1.0.10", {
          tag_name,
          draft: false,
          prerelease: false,
        }),
      /Latest/,
    );
});

void test("workflow checks every matrix artifact on dry runs and isolates release/signing authority", async () => {
  const workflow = parse(
    await readFile(
      new URL("../.github/workflows/vrata-desktop.yml", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(Object.keys(workflow.on).sort(), [
    "pull_request",
    "workflow_dispatch",
  ]);
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(workflow.concurrency["cancel-in-progress"], false);
  const { build, verify, release } = workflow.jobs;
  assert.deepEqual(
    build.strategy.matrix.include.map(({ platform, arch }) => [platform, arch]),
    [
      ["macos", "arm64"],
      ["linux", "x64"],
      ["windows", "x64"],
    ],
  );
  assert(
    build.strategy.matrix.include.every(
      ({ runner }) => !runner.includes("blacksmith"),
    ),
  );
  assert.equal(verify.needs, "build");
  assert(!verify.if?.includes("publish"));
  assert.deepEqual(release.needs, ["build", "verify"]);
  for (const guard of [
    "workflow_dispatch",
    "inputs.publish",
    "refs/heads/main",
    "vrata-tg/vrata-desktop",
  ])
    assert(release.if.includes(guard));
  assert.equal(release.permissions.contents, "write");
  for (const job of [build, verify, release]) {
    const checkout = job.steps.find(({ uses }) =>
      uses?.startsWith("actions/checkout@"),
    );
    assert.equal(checkout.with.ref, "${{ github.sha }}");
    assert.equal(checkout.with["persist-credentials"], false);
    const install = job.steps.find(({ run }) => run?.includes("pnpm install"));
    assert(install.run.includes("--frozen-lockfile --ignore-scripts"));
  }
  const packageStep = build.steps.find(
    ({ name }) => name === "Package and verify installers",
  );
  assert(packageStep.run.includes("--check-signing"));
  assert(packageStep.run.includes("codesign --verify --deep --strict"));
  assert(packageStep.run.includes("spctl --assess"));
  assert(packageStep.run.includes("xcrun stapler validate"));
  for (const secret of Object.keys(signing)) {
    const expression = packageStep.env[secret];
    for (const guard of [
      "matrix.platform == 'macos'",
      "github.event_name == 'workflow_dispatch'",
      "github.ref == 'refs/heads/main'",
    ])
      assert(expression.includes(guard));
  }
  assert(!JSON.stringify(verify).includes("secrets."));
  assert(!JSON.stringify(release).includes("secrets."));
  assert(
    verify.steps.some(
      ({ run }) => run === "node scripts/vrata-release.mjs release",
    ),
  );
  assert(
    release.steps.some(
      ({ run }) => run === "node scripts/vrata-release.mjs release --publish",
    ),
  );
  assert(
    build.steps.some(({ run }) =>
      run?.includes("turbo run desktop:version-feed"),
    ),
  );
  assert(!JSON.stringify(workflow).includes("--publish always"));
});

void test("same-SHA draft cannot advance Latest after a newer release appeared", async (t) => {
  const { root, result } = await signedFixture(t);
  const release = {
    id: 42,
    draft: true,
    prerelease: false,
    tag_name: result.tag,
    name: "Vrata Desktop 1.0.0",
    body: `${result.notes}\nSource SHA: ${sha}.\n`,
    target_commitish: sha,
  };
  const gh = github(result, {
    release,
    tagSha: sha,
    latest: { tag_name: "vrata-v1.0.1", draft: false, prerelease: false },
  });
  await assert.rejects(
    publishRelease(root, config, result, environment, gh.run),
    /strictly newer/,
  );
  assert(!gh.published());
  assert(!gh.calls.some((args) => args.includes("PATCH")));
});

void test("draft SHA and provenance checks happen before any upload", async (t) => {
  const { root, result } = await signedFixture(t);
  const draft = {
    id: 42,
    draft: true,
    prerelease: false,
    tag_name: result.tag,
    name: "Vrata Desktop 1.0.0",
    body: `${result.notes}\nSource SHA: ${sha}.\n`,
    target_commitish: sha,
  };
  for (const change of [
    { target_commitish: "b".repeat(40) },
    { body: "Foreign release" },
    { name: "Foreign release" },
  ]) {
    const gh = github(result, { release: { ...draft, ...change } });
    await assert.rejects(
      publishRelease(root, config, result, environment, gh.run),
      /Foreign draft/,
    );
    assert(!gh.calls.some((args) => args[1] === "upload"));
  }
});

void test("API errors are not treated as absent releases", async (t) => {
  const { root, result } = await signedFixture(t);
  const calls = [];
  await assert.rejects(
    publishRelease(root, config, result, environment, async (args) => {
      calls.push(args);
      throw new Error("HTTP 403 permission denied");
    }),
    /403/,
  );
  assert.equal(calls.length, 1);
});
