const DESKTOP_RELEASE_CHANNEL_ENV_NAME = "BB_DESKTOP_RELEASE_CHANNEL";

export function resolveDesktopReleaseChannel(env) {
  const rawChannel = env[DESKTOP_RELEASE_CHANNEL_ENV_NAME]?.trim();
  if (rawChannel === undefined || rawChannel.length === 0) {
    return "latest";
  }
  if (rawChannel === "latest") {
    return rawChannel;
  }

  throw new Error(
    `${DESKTOP_RELEASE_CHANNEL_ENV_NAME} must be latest, got ${rawChannel}.`,
  );
}

export function resolveDesktopBuildPlatform(nodePlatform) {
  if (nodePlatform === "darwin") {
    return "macos";
  }
  if (nodePlatform === "linux") {
    return "linux";
  }
  if (nodePlatform === "win32") {
    return "windows";
  }

  throw new Error(
    `Desktop builds support darwin, linux, and win32 only, got ${nodePlatform}.`,
  );
}

export function createDesktopReleaseConfig(channel) {
  return {
    appId: "tg.vrata.bb",
    applicationName: "Vrata Desktop",
    artifactName: "vrata-bb-${version}-${arch}.${ext}",
    iconFileName: "icon.png",
    linuxExecutableName: "vrata-bb",
    macIconPath: "assets/icon.icns",
    windowsInstallName: "vrata-bb",
    updateMetadataFileNames: {
      linux: `${channel}-linux.yml`,
      macos: `${channel}-mac.yml`,
      windows: `${channel}.yml`,
    },
  };
}

export function createDesktopUpdateReleaseBaseUrl() {
  return "https://github.com/vrata-tg/vrata-desktop/releases/latest/download/";
}
