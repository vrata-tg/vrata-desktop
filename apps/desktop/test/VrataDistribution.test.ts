import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  createDesktopReleaseConfig,
  resolveDesktopReleaseChannel,
} from "../scripts/desktop-release-channel.mjs";
import { createDesktopReleaseInfo } from "../src/desktop-update-provider.js";
import { resolveDesktopIconPath } from "../src/app-paths.js";
import { DEFAULT_BB_SERVER_URL } from "../src/types.js";

const desktopPackageRoot = process.cwd();

describe("Vrata distribution identity", () => {
  it("agrees on the application identity in the build and running application", async () => {
    const runtime = createDesktopReleaseInfo("latest");
    const build = createDesktopReleaseConfig("latest");

    expect(runtime.appId).toBe("tg.vrata.bb");
    expect(build.appId).toBe("tg.vrata.bb");
    expect(runtime.applicationName).toBe("Vrata Desktop");
    expect(build.applicationName).toBe("Vrata Desktop");
    expect(build.linuxExecutableName).toBe("vrata-bb");
    expect(build.windowsInstallName).toBe("vrata-bb");
    expect(build.artifactName).toBe("vrata-bb-${version}-${arch}.${ext}");
    expect(DEFAULT_BB_SERVER_URL).toBe("http://127.0.0.1:38986");
    expect(
      JSON.parse(
        await readFile(
          join(desktopPackageRoot, "electron-builder.config.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      appId: "tg.vrata.bb",
      productName: "Vrata Desktop",
      artifactName: "vrata-bb-${version}-${arch}.${ext}",
      linux: { executableName: "vrata-bb", icon: "assets/icon.png" },
      mac: { icon: "assets/icon.icns" },
      win: { icon: "assets/icon.ico" },
    });
  });

  it("ships the Vrata sign in the runtime and platform icon formats", async () => {
    const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
    const release = createDesktopReleaseInfo("latest");
    const runtimeIcons = await Promise.all(
      [true, false].map((devIcon) =>
        readFile(
          resolveDesktopIconPath({
            devIcon,
            packagedIconFileName: release.iconFileName,
            paths: {
              appPath: desktopPackageRoot,
              isPackaged: !devIcon,
              resourcesPath: "/resources",
            },
          }),
        ),
      ),
    );
    for (const png of runtimeIcons) {
      expect(png.subarray(0, 8)).toEqual(pngSignature);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        1024, 1024,
      ]);
    }
    expect(runtimeIcons[0]).toEqual(runtimeIcons[1]);

    const ico = await readFile(join(desktopPackageRoot, "assets/icon.ico"));
    expect([
      ico.readUInt16LE(0),
      ico.readUInt16LE(2),
      ico.readUInt16LE(4),
    ]).toEqual([0, 1, 7]);
    const icoSizes: number[] = [];
    const iconImages = new Map<number, Buffer>();
    for (let index = 0; index < ico.readUInt16LE(4); index += 1) {
      const entry = 6 + index * 16;
      const size = ico[entry] || 256;
      const offset = ico.readUInt32LE(entry + 12);
      const length = ico.readUInt32LE(entry + 8);
      const png = ico.subarray(offset, offset + length);
      expect(png.subarray(0, 8)).toEqual(pngSignature);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        size,
        size,
      ]);
      icoSizes.push(size);
      iconImages.set(size, png);
    }
    expect(icoSizes).toEqual([16, 24, 32, 48, 64, 128, 256]);
    for (const size of [16, 32]) {
      for (const suffix of ["", "-dark", "-dev"]) {
        const favicon = await readFile(
          join(
            desktopPackageRoot,
            `../app/public/favicon-${size}x${size}${suffix}.png`,
          ),
        );
        expect(favicon).toEqual(iconImages.get(size));
      }
    }

    const icns = await readFile(join(desktopPackageRoot, "assets/icon.icns"));
    expect(icns.toString("ascii", 0, 4)).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const icnsSizes: number[] = [];
    for (let offset = 8; offset < icns.length;) {
      const length = icns.readUInt32BE(offset + 4);
      expect(length).toBeGreaterThan(8);
      const png = icns.subarray(offset + 8, offset + length);
      expect(png.subarray(0, 8)).toEqual(pngSignature);
      expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
      icnsSizes.push(png.readUInt32BE(16));
      offset += length;
    }
    expect(icnsSizes).toEqual([16, 32, 64, 128, 256, 512, 1024]);
  });

  it("accepts only the latest release channel", () => {
    for (const value of [undefined, "", "latest", " latest "]) {
      expect(
        resolveDesktopReleaseChannel({ BB_DESKTOP_RELEASE_CHANNEL: value }),
      ).toBe("latest");
    }
    for (const value of ["nightly", "canary"]) {
      expect(() =>
        resolveDesktopReleaseChannel({ BB_DESKTOP_RELEASE_CHANNEL: value }),
      ).toThrow("must be latest");
    }
  });

  it.each([
    { isPackaged: true, userDataDir: "" },
    { isPackaged: false, userDataDir: "" },
    { isPackaged: true, userDataDir: "/isolated/user-data" },
    { isPackaged: false, userDataDir: "/isolated/user-data" },
  ])(
    "preserves the Electron profile override and credential name before displaying the new name (packaged=$isPackaged, userDataDir=$userDataDir)",
    async ({ isPackaged, userDataDir }) => {
      const source = stripTypeScriptTypes(
        await readFile(join(desktopPackageRoot, "src/main.ts"), "utf8"),
      );
      const startup = source.slice(
        source.indexOf("async function runDesktopApp()"),
        source.indexOf("void runDesktopApp().catch"),
      );
      const paths = new Map<string, string>([["appData", "/profile"]]);
      const createdPaths = new Set<string>();
      const names: string[] = [];
      const aboutNames: string[] = [];
      const modelIds: string[] = [];
      const initialization: Array<{
        name: string | undefined;
        userData: string | undefined;
        sessionData: string | undefined;
      }> = [];
      const stop = new Error("startup identity observed");
      const app = {
        isPackaged,
        commandLine: {
          getSwitchValue: (name: string) =>
            name === "user-data-dir" ? userDataDir : "",
        },
        getPath: (name: string) => paths.get(name),
        setPath(name: string, value: string) {
          if (!createdPaths.has(value))
            throw new Error("profile directory does not exist");
          paths.set(name, value);
        },
        setName: (name: string) => names.push(name),
        setAppUserModelId: (id: string) => modelIds.push(id),
        requestSingleInstanceLock: () => true,
        on: () => {},
        async whenReady() {
          initialization.push({
            name: names.at(-1),
            userData: paths.get("userData"),
            sessionData: paths.get("sessionData"),
          });
        },
      };
      const runStartup: () => Promise<void> = runInNewContext(
        `${startup}\nrunDesktopApp`,
        {
          app,
          join,
          mkdirSync: (path: string) => createdPaths.add(path),
          process: { platform: "darwin", env: {} },
          DESKTOP_RELEASE_CHANNEL: "latest",
          DESKTOP_RELEASE_INFO: createDesktopReleaseInfo("latest"),
          installAboutPanel: (name: string) => aboutNames.push(name),
          handleBeforeQuit: () => {},
          registerDesktopShutdownSignalHandlers: () => {},
          hostToolchain: { refresh: async () => {}, environment: () => ({}) },
          session: { defaultSession: { clearCache: async () => {} } },
          createDesktopPathContext: () => {
            throw stop;
          },
        },
      );

      await expect(runStartup()).rejects.toBe(stop);
      const profileName = isPackaged ? "Vrata BB" : "bb-dev";
      const profilePath = userDataDir || join("/profile", profileName);
      expect(initialization).toEqual([
        {
          name: profileName,
          userData: profilePath,
          sessionData: profilePath,
        },
      ]);
      expect(createdPaths).toEqual(new Set([profilePath]));
      expect(names.at(-1)).toBe("Vrata Desktop");
      expect(aboutNames).toEqual(["Vrata Desktop"]);
      expect(modelIds).toEqual(["tg.vrata.bb"]);
    },
  );
});
