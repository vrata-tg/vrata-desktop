import {
  createBbDesktopVersionFeedFileName,
  type BbDesktopVersionFeedPlatform,
} from "@bb/desktop-contract";

type DesktopReleaseChannel = "latest";

interface DesktopReleaseInfo {
  appId: "tg.vrata.bb";
  applicationName: "Vrata Desktop";
  channel: DesktopReleaseChannel;
  iconFileName: "icon.png";
  updateReleaseBaseUrl: string;
}

export function createDesktopReleaseInfo(
  channel: DesktopReleaseChannel,
): DesktopReleaseInfo {
  return {
    appId: "tg.vrata.bb",
    applicationName: "Vrata Desktop",
    channel,
    iconFileName: "icon.png",
    updateReleaseBaseUrl:
      "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/",
  };
}

function resolveBuiltDesktopReleaseChannel(
  rawChannel: string | undefined,
): DesktopReleaseChannel {
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest") {
    return rawChannel;
  }

  throw new Error(
    `Built desktop release channel must be latest, got ${String(rawChannel)}.`,
  );
}

export const DESKTOP_RELEASE_CHANNEL = resolveBuiltDesktopReleaseChannel(
  process.env.BB_DESKTOP_RELEASE_CHANNEL,
);
export const DESKTOP_RELEASE_INFO = createDesktopReleaseInfo(
  DESKTOP_RELEASE_CHANNEL,
);
const DESKTOP_UPDATE_RELEASE_BASE_URL = DESKTOP_RELEASE_INFO.updateReleaseBaseUrl;

export function createDesktopUpdateFeedUrl(
  platform: BbDesktopVersionFeedPlatform,
): string {
  return `${DESKTOP_UPDATE_RELEASE_BASE_URL}${createBbDesktopVersionFeedFileName(platform)}`;
}

export interface DesktopAutoUpdateFeedConfig {
  channel: DesktopReleaseChannel;
  provider: "generic";
  url: string;
}

export const DESKTOP_AUTO_UPDATE_FEED_CONFIG: DesktopAutoUpdateFeedConfig = {
  channel: DESKTOP_RELEASE_CHANNEL,
  provider: "generic",
  url: DESKTOP_UPDATE_RELEASE_BASE_URL,
};

interface DesktopUpdateSupport {
  autoUpdate: boolean;
  versionCheck: boolean;
}

interface ResolveDesktopUpdateSupportArgs {
  canReplaceAppImage: (appImagePath: string) => boolean;
  env: NodeJS.ProcessEnv;
  platform: BbDesktopVersionFeedPlatform;
}

export function resolveDesktopUpdateSupport(
  args: ResolveDesktopUpdateSupportArgs,
): DesktopUpdateSupport {
  if (args.platform === "macos" || args.platform === "windows") {
    return { autoUpdate: true, versionCheck: true };
  }

  const appImagePath = args.env.APPIMAGE?.trim() ?? "";
  if (appImagePath.length === 0) {
    return { autoUpdate: false, versionCheck: true };
  }

  return {
    autoUpdate: args.canReplaceAppImage(appImagePath),
    versionCheck: true,
  };
}
