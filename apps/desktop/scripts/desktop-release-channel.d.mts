export type DesktopReleaseChannel = "latest";
export type DesktopBuildPlatform = "macos" | "linux" | "windows";

export interface DesktopUpdateMetadataFileNames {
  linux: "latest-linux.yml";
  macos: "latest-mac.yml";
  windows: "latest.yml";
}

export interface DesktopReleaseConfig {
  appId: "tg.vrata.bb";
  applicationName: "Vrata Desktop";
  artifactName: string;
  iconFileName: "icon.png";
  linuxExecutableName: "vrata-bb";
  macIconPath: "assets/icon.icns";
  updateMetadataFileNames: DesktopUpdateMetadataFileNames;
  windowsInstallName: "vrata-bb";
}

export function resolveDesktopReleaseChannel(
  env: NodeJS.ProcessEnv,
): DesktopReleaseChannel;

export function resolveDesktopBuildPlatform(
  nodePlatform: string,
): DesktopBuildPlatform;

export function createDesktopReleaseConfig(
  channel: DesktopReleaseChannel,
): DesktopReleaseConfig;

export function createDesktopUpdateReleaseBaseUrl(): string;
