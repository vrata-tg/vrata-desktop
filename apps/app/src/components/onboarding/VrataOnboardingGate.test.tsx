// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { liveSystemExecutionOptionsQueryOptions } from "@/hooks/queries/system-queries";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { sdk } from "@/lib/sdk";
import { OnboardingGate } from "./VrataOnboardingGate";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  update: vi.fn(),
  host: vi.fn(),
}));
vi.mock("@/lib/plugin-sdk-hooks", () => ({ callPluginRpc: mocks.rpc }));
vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useSystemRealtimeSubscription: () => undefined,
  useHostListRealtimeSubscription: () => undefined,
}));
vi.mock("@/lib/sdk", () => ({
  BbHttpError: class BbHttpError extends Error {},
  sdk: { system: { config: vi.fn(), executionOptions: vi.fn() } },
}));
vi.mock("@/hooks/queries/host-queries", () => ({ usePrimaryHost: mocks.host }));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutateAsync: mocks.update }),
}));

function settings(completed: string | null = null) {
  const config = makeSystemConfig({
    primaryHostId: "local",
    generalSettings: {
      ...defaultAppSettings,
      onboardingCompletedAt: completed,
      defaultProviderId: "codex",
      streamerMode: true,
      providerOrder: ["provider-codex", "vrata"],
    },
  });
  vi.mocked(sdk.system.config).mockResolvedValue(config);
  queryClient.setQueryData(systemConfigQueryKey(), config);
}
const configured = (value: boolean, hostId = "local") => ({
  hostId,
  configured: value,
  baseUrl: "https://example.invalid/v1",
});
const content = (
  <OnboardingGate>
    <div>Workspace</div>
  </OnboardingGate>
);

let queryClient: QueryClient;

function renderGate() {
  return render(content, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.resetAllMocks();
  settings();
  mocks.host.mockReturnValue({ id: "local", status: "connected" });
  mocks.rpc.mockResolvedValue(configured(false));
  mocks.update.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  window.localStorage.clear();
});

async function submitKey() {
  fireEvent.change(await screen.findByLabelText("Ключ API Врата AI"), {
    target: { value: "  synthetic-test-key  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Начать работу" }));
}

it("saves credentials on the host and completes without replacing user settings", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockResolvedValueOnce(configured(true));
  renderGate();
  await submitKey();
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.rpc).toHaveBeenLastCalledWith(
    fetch,
    "bb-plugin",
    "saveCredentials",
    {
      target: { kind: "host", hostId: "local" },
      apiKey: "synthetic-test-key",
      baseUrl: "https://example.invalid/v1",
    },
  );
  expect(mocks.update).toHaveBeenCalledWith({
    onboardingCompletedAt: expect.any(String),
  });
  expect(JSON.stringify(mocks.update.mock.calls)).not.toContain(
    "synthetic-test-key",
  );
  expect(screen.queryByLabelText("Ключ API Врата AI")).toBeNull();
});

it("keeps rejected credentials out of the error and does not complete onboarding", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockRejectedValueOnce(new Error("synthetic-test-key rejected"));
  renderGate();
  await submitKey();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(mocks.update).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("synthetic-test-key");
  expect(
    screen.getByLabelText<HTMLInputElement>("Ключ API Врата AI").value,
  ).toBe("");
});

it("retries settings persistence without asking for the already saved key", async () => {
  mocks.rpc
    .mockResolvedValueOnce(configured(false))
    .mockResolvedValueOnce(configured(true));
  mocks.update
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(undefined);
  renderGate();
  await submitKey();
  await screen.findByRole("alert");
  expect(screen.queryByLabelText("Ключ API Врата AI")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Начать работу" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(2));
  expect(mocks.rpc).toHaveBeenCalledTimes(2);
});

it("does not reveal the app while an optimistic completion is still being saved", async () => {
  let resolveSave: () => void = () => {};
  mocks.rpc.mockResolvedValue(configured(true));
  mocks.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const view = renderGate();
  fireEvent.click(await screen.findByRole("button", { name: "Начать работу" }));
  settings("2026-10-23T00:00:00Z");
  view.rerender(content);
  expect(screen.queryByText("Workspace")).toBeNull();
  await act(async () => resolveSave());
  expect(await screen.findByText("Workspace")).toBeTruthy();
});

it("does not complete for a stale save after switching hosts", async () => {
  let resolveSave: (value: ReturnType<typeof configured>) => void = () => {};
  mocks.rpc.mockResolvedValueOnce(configured(false)).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
  );
  const view = renderGate();
  await submitKey();
  mocks.host.mockReturnValue({ id: "other", status: "connected" });
  mocks.rpc.mockResolvedValue(configured(false, "other"));
  view.rerender(
    <OnboardingGate>
      <div>Workspace</div>
    </OnboardingGate>,
  );
  await act(async () => resolveSave(configured(true)));
  expect(mocks.update).not.toHaveBeenCalled();
});

it("rejects a configuration response for a different host", async () => {
  mocks.rpc.mockResolvedValue(configured(true, "wrong-host"));
  renderGate();
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Начать работу" })).toBeNull();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("waits for the plugin to start without requiring a manual retry", async () => {
  mocks.rpc
    .mockRejectedValueOnce(new Error("starting"))
    .mockResolvedValueOnce(configured(false));
  renderGate();
  expect(
    await screen.findByLabelText("Ключ API Врата AI", {}, { timeout: 3000 }),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("opens a completed installation without reading credentials", () => {
  settings("2026-10-23T00:00:00Z");
  renderGate();
  expect(screen.getByText("Workspace")).toBeTruthy();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("continues with an existing host-local key without saving credentials again", async () => {
  mocks.rpc.mockResolvedValue(configured(true));
  renderGate();
  fireEvent.click(await screen.findByRole("button", { name: "Начать работу" }));
  await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.update).toHaveBeenCalledWith({
    onboardingCompletedAt: expect.any(String),
  });
});

it("waits for the primary host to connect before reading its credentials", () => {
  mocks.host.mockReturnValue({ id: "local", status: "disconnected" });
  renderGate();
  expect(screen.getByRole("status").textContent).toBe(
    "Запускаем рабочую среду…",
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(mocks.update).not.toHaveBeenCalled();
});

it("clears the configuration error while a manual retry is pending", async () => {
  let resolveConfiguration: (value: ReturnType<typeof configured>) => void = () =>
    {};
  mocks.rpc
    .mockResolvedValueOnce(configured(false, "wrong-host"))
    .mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveConfiguration = resolve;
      }),
    );
  renderGate();
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Подключаем Врата AI…")).toBeTruthy();
  await act(async () => resolveConfiguration(configured(false)));
  expect(await screen.findByLabelText("Ключ API Врата AI")).toBeTruthy();
});

it("leaves setup retryable when the host has not saved the submitted credentials", async () => {
  renderGate();
  await submitKey();
  await screen.findByRole("alert");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(
    screen.getByLabelText<HTMLInputElement>("Ключ API Врата AI").value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("Ключ API Врата AI"), {
    target: { value: "replacement-key" },
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Начать работу" })
      .disabled,
  ).toBe(false);
});

it.each([undefined, "local"])(
  "fetches the authenticated catalog after onboarding with a fresh empty client cache (host %s)",
  async (hostId) => {
    const options = liveSystemExecutionOptionsQueryOptions(
      hostId === undefined
        ? { providerId: "vrata" }
        : { providerId: "vrata", hostId },
    );
    const emptyCatalog: SystemExecutionOptionsResponse = {
      providers: [makeProviderInfo({ id: "vrata", displayName: "Врата AI" })],
      models: [],
      selectedOnlyModels: [],
      permissionCeiling: "full",
      modelLoadError: null,
    };
    vi.mocked(sdk.system.executionOptions).mockResolvedValue(emptyCatalog);
    await queryClient.fetchQuery(options);
    mocks.rpc
      .mockResolvedValueOnce(configured(false))
      .mockResolvedValueOnce(configured(true));
    mocks.update.mockImplementation(async () => {
      settings("2026-10-23T00:00:00Z");
    });
    vi.mocked(sdk.system.executionOptions).mockResolvedValue({
      ...emptyCatalog,
      models: [
        {
          id: "authenticated-model",
          model: "authenticated-model",
          displayName: "Authenticated model",
          description: "",
          reasoningDiscovery: "known",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    });
    function Catalog() {
      const query = useQuery(options);
      return <div>{query.data?.models[0]?.displayName ?? "No models"}</div>;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <OnboardingGate>
          <Catalog />
        </OnboardingGate>
      </QueryClientProvider>,
    );
    await submitKey();
    expect(await screen.findByText("Authenticated model")).toBeTruthy();
    expect(sdk.system.executionOptions).toHaveBeenCalledTimes(2);
  },
);
