import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPublishedHost } from "./prepare-bundled.mjs";

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "vrata-host-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "dist"));
  const bytes = Buffer.from("published-host");
  const meta = {
    artifactFormatVersion: 1,
    sdkMajor: 0,
    pluginId: "bb-plugin",
    pluginVersion: "0.1.13",
    artifactDigest: createHash("sha256").update(bytes).digest("hex"),
    ...overrides,
  };
  await writeFile(join(root, "dist/host.js"), bytes);
  await writeFile(join(root, "dist/host.meta.json"), JSON.stringify(meta));
  return { root, bytes };
}

test("valid published host is preserved byte for byte", async (t) => {
  const { root, bytes } = await fixture(t);
  assert.deepEqual((await readPublishedHost(root, "0.1.13")).bytes, bytes);
});

for (const [field, value] of [
  ["sdkMajor", 1],
  ["pluginId", "vrata"],
  ["pluginVersion", "0.1.12"],
  ["artifactDigest", "bad"],
  ["artifactFormatVersion", 2],
]) {
  test(`rejects published host with incompatible ${field}`, async (t) => {
    const { root } = await fixture(t, { [field]: value });
    await assert.rejects(readPublishedHost(root, "0.1.13"));
  });
}
