import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  defaultAppSettings,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["bb/", "", "sawyer/wt-", "team/bb/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " bb/",
      "bb //",
      "-bb/",
      "/bb/",
      "bb//",
      "bb../",
      "bb:",
      "bb~",
      "bb\\",
      "bb@{",
      ".bb/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the bb namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("bb/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});

describe("Vrata provider default", () => {
  it("starts a new profile with Vrata and unfinished onboarding", () => {
    expect(appSettingsSchema.parse(defaultAppSettings)).toMatchObject({
      defaultProviderId: "vrata",
      onboardingCompletedAt: null,
    });
  });

  it.each([null, "codex", "vrata"])(
    "preserves an explicit provider choice: %s",
    (defaultProviderId) => {
      const settings = {
        ...defaultAppSettings,
        defaultProviderId,
        providerOrder: ["codex", "vrata"],
        onboardingCompletedAt: "2026-10-23T00:00:00.000Z",
      };
      expect(appSettingsSchema.parse(settings)).toEqual(settings);
    },
  );
});
