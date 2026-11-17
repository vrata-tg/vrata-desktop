import { describe, expect, it } from "vitest";
import {
  createDesktopUpdateFeedUrl,
  DESKTOP_AUTO_UPDATE_FEED_CONFIG,
  resolveDesktopUpdateSupport,
} from "../src/desktop-update-provider.js";

describe("desktop update feed url", () => {
  it("downloads through the same latest Vrata release as version checks", () => {
    expect(DESKTOP_AUTO_UPDATE_FEED_CONFIG).toEqual({
      channel: "latest",
      provider: "generic",
      url: "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/",
    });
  });

  it("gives each platform its own feed file in the latest Vrata release", () => {
    expect(createDesktopUpdateFeedUrl("macos")).toBe(
      "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/desktop-version.json",
    );
    expect(createDesktopUpdateFeedUrl("linux")).toBe(
      "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/desktop-version-linux.json",
    );
    expect(createDesktopUpdateFeedUrl("windows")).toBe(
      "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/desktop-version-windows.json",
    );
  });
});

const APP_IMAGE_PATH = "/home/user/Apps/vrata-bb-1.0.0-x64.AppImage";
const alwaysReplaceable = () => true;
const neverReplaceable = () => false;

describe("desktop update support", () => {
  it("enables both update paths on macOS", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: neverReplaceable,
        env: {},
        platform: "macos",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
  });

  it("checks for and installs updates on Windows", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "windows",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
  });

  it("installs updates on Linux only inside an AppImage", () => {
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: true, versionCheck: true });
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: {},
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: alwaysReplaceable,
        env: { APPIMAGE: "  " },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
  });

  it("refuses to install into an AppImage it cannot replace", () => {
    const checked: Array<string> = [];

    expect(
      resolveDesktopUpdateSupport({
        canReplaceAppImage: (path) => {
          checked.push(path);
          return false;
        },
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform: "linux",
      }),
    ).toEqual({ autoUpdate: false, versionCheck: true });
    expect(checked).toEqual([APP_IMAGE_PATH]);
  });

  it.each(["macos", "windows"] as const)(
    "does not consult the AppImage filesystem on %s",
    (platform) => {
      let consulted = false;

      resolveDesktopUpdateSupport({
        canReplaceAppImage: () => {
          consulted = true;
          return true;
        },
        env: { APPIMAGE: APP_IMAGE_PATH },
        platform,
      });

      expect(consulted).toBe(false);
    },
  );
});
