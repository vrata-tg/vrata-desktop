import { getAppSettings, setAppSettings } from "@bb/db";
import { createDeferredPromise } from "@bb/test-helpers";
import { expect, it, vi } from "vitest";
import { resolveSystemExecutionOptions } from "../../src/services/system/execution-options.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import {
  catalogAnswer,
  errorAnswer,
  healthAnswer,
  installCatalogStore,
  modelList,
} from "../helpers/provider-model-catalogs.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

it("refreshes a catalog cached before credentials when onboarding completes", async () => {
  await withTestHarness(async (harness) => {
    installCatalogStore(harness, { clock: { now: 1_800_000_000_000 } });
    const { host, session } = seedHostSession(harness.deps);
    let configured = false;
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: ({ command }) => {
        if (command.type === "provider.health") return healthAnswer("ready");
        if (command.type === "provider.list_models")
          return catalogAnswer(
            modelList(configured ? "authenticated-model" : "setup-model"),
          );
        throw new Error(`Unexpected RPC ${command.type}`);
      },
    });
    const readModels = async () =>
      (
        await resolveSystemExecutionOptions(harness.deps, {
          hostId: host.id,
          providerId: "codex",
        })
      ).models.map((model) => model.model);
    expect(await readModels()).toEqual(["setup-model"]);
    configured = true;
    async function saveSettings(onboardingCompletedAt: string | null) {
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...getAppSettings(harness.db),
          onboardingCompletedAt,
        }),
      });
      expect(response.status).toBe(200);
    }
    await saveSettings(null);
    expect(await readModels()).toEqual(["setup-model"]);
    await saveSettings("2026-10-23T00:00:00.000Z");
    await vi.waitFor(async () => {
      expect(await readModels()).toEqual(["authenticated-model"]);
    });
    configured = false;
    await saveSettings("2026-10-23T00:00:00.000Z");
    expect(await readModels()).toEqual(["authenticated-model"]);
  });
});

it("loads the authenticated catalog after onboarding before an earlier authentication failure settles", async () => {
  await withTestHarness(async (harness) => {
    installCatalogStore(harness, { clock: { now: 1_800_000_000_000 } });
    const { host, session } = seedHostSession(harness.deps);
    const initialResponse = createDeferredPromise<HostRpcHandlerResult>();
    let catalogRequests = 0;
    registerHostRpcResponder(harness, {
      hostId: host.id,
      sessionId: session.id,
      handle: ({ command }) => {
        if (command.type === "provider.health") return healthAnswer("ready");
        if (command.type === "provider.list_models") {
          catalogRequests += 1;
          return catalogRequests === 1
            ? initialResponse.promise
            : catalogAnswer(modelList("authenticated-model"));
        }
        throw new Error(`Unexpected RPC ${command.type}`);
      },
    });
    const readCatalog = () =>
      resolveSystemExecutionOptions(harness.deps, {
        hostId: host.id,
        providerId: "codex",
        preferCached: "true",
      });
    const initialRead = readCatalog();
    const pendingReads = [initialRead];
    try {
      await vi.waitFor(() => {
        expect(catalogRequests).toBe(1);
      });
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...getAppSettings(harness.db),
          onboardingCompletedAt: "2026-10-23T00:00:00.000Z",
        }),
      });
      expect(response.status).toBe(200);
      const authenticatedRead = readCatalog();
      pendingReads.push(authenticatedRead);
      await vi.waitFor(() => {
        expect(catalogRequests).toBe(2);
      });
      expect(await authenticatedRead).toMatchObject({
        models: [{ model: "authenticated-model" }],
        modelLoadError: null,
      });
      initialResponse.resolve(errorAnswer("auth_required"));
      await initialRead;
      expect(await readCatalog()).toMatchObject({
        models: [{ model: "authenticated-model" }],
        modelLoadError: null,
      });
      expect(catalogRequests).toBe(2);
    } finally {
      initialResponse.resolve(errorAnswer("auth_required"));
      await Promise.allSettled(pendingReads);
    }
  });
});

it("defaults new profiles to Vrata and preserves existing settings when completing onboarding", async () => {
  await withTestHarness(async (harness) => {
    expect(getAppSettings(harness.db).defaultProviderId).toBe("vrata");
    for (const defaultProviderId of [null, "codex", "vrata"]) {
      const existing = {
        ...getAppSettings(harness.db),
        defaultProviderId,
        providerOrder: ["codex", "vrata"],
        streamerMode: true,
        onboardingCompletedAt: null,
      };
      setAppSettings(harness.db, existing);
      const completed = {
        ...existing,
        onboardingCompletedAt: "2026-10-23T00:00:00.000Z",
      };
      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(completed),
      });
      expect(response.status).toBe(200);
      expect(getAppSettings(harness.db)).toEqual(completed);
    }
  });
});
