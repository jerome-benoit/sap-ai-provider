/** SAP HTTP transport contracts for Responses requests and response cancellation. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider-v3";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";

import { APICallError } from "@ai-sdk/provider";
import { getFoundationModelDeploymentId } from "@sap-ai-sdk/ai-api/internal.js";
import { executeRequest, getAiCoreDestination } from "@sap-ai-sdk/core";
import { ErrorWithCause } from "@sap-cloud-sdk/util";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { createResponsesTransport } from "./responses-http-transport.js";
import { createSAPAIProvider } from "./sap-ai-provider.js";

vi.mock("@sap-ai-sdk/core", () => ({
  executeRequest: vi.fn(),
  getAiCoreDestination: vi.fn(),
}));
vi.mock("@sap-ai-sdk/ai-api/internal.js", () => ({
  getFoundationModelDeploymentId: vi.fn(),
  getResourceGroup: (deployment: { resourceGroup?: string }) => deployment.resourceGroup,
}));

const config: LanguageModelStrategyConfig = {
  deploymentConfig: { resourceGroup: "production" },
  destination: { authentication: "NoAuthentication", url: "https://sap.example.test/v2" },
  modelId: "gpt-6.1-sol",
  provider: "sap-ai.chat",
};
const options: LanguageModelV3CallOptions = {
  prompt: [{ content: [{ text: "Hello", type: "text" }], role: "user" }],
};
const request = {
  body: JSON.stringify({ input: "Hello", store: false }),
  headers: { authorization: "Bearer delegate-placeholder", "content-type": "application/json" },
  method: "POST",
};

/**
 * Checks that discovery leaves no caller abort listeners installed.
 * @param added - Observed listener registrations.
 * @param removed - Observed listener removals.
 */
function expectAbortListenersRemoved(
  added: readonly Parameters<AbortSignal["addEventListener"]>[],
  removed: readonly Parameters<AbortSignal["removeEventListener"]>[],
): void {
  const abortListeners = added.filter(([type]) => type === "abort");
  expect(abortListeners.length).toBeGreaterThan(0);
  for (const [, listener] of abortListeners) {
    expect(removed.some(([type, removed]) => type === "abort" && removed === listener)).toBe(true);
  }
}

/**
 * Exposes pending SAP work without adding a fixture timer.
 * @returns The pending operation and its settlement functions.
 */
function pendingLookup<T>(): {
  promise: Promise<T>;
  reject: (reason: Error) => void;
  resolve: (value: T) => void;
} {
  let rejectLookup: ((reason: Error) => void) | undefined;
  let resolveLookup: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    rejectLookup = reject;
    resolveLookup = resolve;
  });
  return {
    promise,
    reject(reason) {
      if (!rejectLookup) throw new Error("Pending lookup fixture was not initialized.");
      rejectLookup(reason);
    },
    resolve(value) {
      if (!resolveLookup) throw new Error("Pending lookup fixture was not initialized.");
      resolveLookup(value);
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getFoundationModelDeploymentId).mockResolvedValue("deployment-1");
  vi.mocked(getAiCoreDestination).mockResolvedValue({ url: "https://sap.example.test/v2" });
  vi.mocked(executeRequest).mockImplementation(() =>
    Promise.resolve({
      data: Readable.from(["first", Buffer.from("second")]),
      headers: { "Content-Type": "application/json", "X-Request-Id": "request-1" },
      request: {},
      status: 201,
    }),
  );
});

describe("Responses HTTP transport", () => {
  it.each(["doGenerate", "doStream"] as const)(
    "%s rejects an already-aborted call before starting SAP discovery",
    async (operation) => {
      const caller = new AbortController();
      const reason = new Error("already stopped");
      caller.abort(reason);
      const added = vi.spyOn(caller.signal, "addEventListener");
      const model = createSAPAIProvider({ api: "responses", destination: config.destination })(
        config.modelId,
      );

      await expect(
        model[operation]({ ...options, abortSignal: caller.signal }),
      ).rejects.toMatchObject({
        cause: { cause: reason, name: "AbortError" },
        isRetryable: false,
        statusCode: 499,
      });
      expect(getFoundationModelDeploymentId).not.toHaveBeenCalled();
      expect(getAiCoreDestination).not.toHaveBeenCalled();
      expect(executeRequest).not.toHaveBeenCalled();
      expect(added).not.toHaveBeenCalled();
    },
  );

  it.each(["doGenerate", "doStream"] as const)(
    "%s keeps a discovery-shaped abort reason at 499 without exposing its criteria",
    async (operation) => {
      const sentinel = "public-abort-discovery-credential";
      const reason = new Error(
        `No deployment matched the given criteria: ${JSON.stringify({
          destination: { authentication: "NoAuthentication", password: sentinel },
        })}`,
      );
      const caller = new AbortController();
      caller.abort(reason);
      const model = createSAPAIProvider({ api: "responses", destination: config.destination })(
        config.modelId,
      );

      const error: unknown = await model[operation]({
        ...options,
        abortSignal: caller.signal,
      }).catch((error: unknown) => error);

      expect(APICallError.isInstance(error)).toBe(true);
      if (!APICallError.isInstance(error)) throw new Error("Expected client cancellation");
      expect(error).toMatchObject({ isRetryable: false, statusCode: 499 });
      expect(error.cause).toBeUndefined();
      expect(caller.signal.reason).toBe(reason);
      for (const summary of [error.message, String(error), error.stack, JSON.stringify(error)]) {
        expect(summary).not.toContain(sentinel);
        expect(summary).not.toContain("NoAuthentication");
      }
      expect(getFoundationModelDeploymentId).not.toHaveBeenCalled();
      expect(getAiCoreDestination).not.toHaveBeenCalled();
      expect(executeRequest).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["doGenerate", "deployment"],
    ["doGenerate", "destination"],
    ["doStream", "deployment"],
    ["doStream", "destination"],
  ] as const)(
    "%s settles cancellation during pending %s discovery and handles late failure",
    async (operation, lookup) => {
      const pending = pendingLookup<never>();
      if (lookup === "deployment") {
        vi.mocked(getFoundationModelDeploymentId).mockReturnValue(pending.promise);
      } else {
        vi.mocked(getAiCoreDestination).mockReturnValue(pending.promise);
      }
      const caller = new AbortController();
      const added = vi.spyOn(caller.signal, "addEventListener");
      const removed = vi.spyOn(caller.signal, "removeEventListener");
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      const model = createSAPAIProvider({ api: "responses", destination: config.destination })(
        config.modelId,
      );
      const failures: unknown[] = [];
      const invocation = model[operation]({ ...options, abortSignal: caller.signal }).catch(
        (error: unknown) => failures.push(error),
      );
      const reason = new Error(`stopped during ${lookup} discovery`);
      try {
        await vi.waitFor(() => {
          expect(getFoundationModelDeploymentId).toHaveBeenCalledTimes(1);
          expect(getAiCoreDestination).toHaveBeenCalledTimes(1);
        });
        caller.abort(reason);
        await setImmediate();

        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          cause: { cause: reason, name: "AbortError" },
          isRetryable: false,
          statusCode: 499,
        });
        expect(executeRequest).not.toHaveBeenCalled();
        expectAbortListenersRemoved(added.mock.calls, removed.mock.calls);
      } finally {
        pending.reject(new Error("late SAP discovery failure"));
        await invocation;
        await setImmediate();
        process.removeListener("unhandledRejection", unhandled);
      }
      expect(failures).toHaveLength(1);
      expect(unhandled).not.toHaveBeenCalled();
    },
  );

  it.each(["success", "failure"] as const)(
    "removes the caller abort listener after discovery %s",
    async (outcome) => {
      const caller = new AbortController();
      const added = vi.spyOn(caller.signal, "addEventListener");
      const removed = vi.spyOn(caller.signal, "removeEventListener");
      if (outcome === "failure") {
        vi.mocked(getFoundationModelDeploymentId).mockRejectedValue(
          new Error("SAP discovery failed"),
        );
      }
      const result = createResponsesTransport(
        config,
        {},
        { ...options, abortSignal: caller.signal },
      );
      if (outcome === "failure") {
        await expect(result).rejects.toThrow("SAP discovery failed");
      } else {
        await result;
      }
      expectAbortListenersRemoved(added.mock.calls, removed.mock.calls);
      expect(executeRequest).not.toHaveBeenCalled();
    },
  );

  it("handles abort during discovery startup without orphaning a later lookup failure", async () => {
    const caller = new AbortController();
    const reason = new Error("stopped while starting discovery");
    const pending = pendingLookup<never>();
    vi.mocked(getFoundationModelDeploymentId).mockImplementation(() => {
      caller.abort(reason);
      return pending.promise;
    });
    const failures: unknown[] = [];
    const invocation = createResponsesTransport(
      config,
      {},
      { ...options, abortSignal: caller.signal },
    ).catch((error: unknown) => failures.push(error));
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      await setImmediate();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ cause: reason, name: "AbortError" });
    } finally {
      pending.reject(new Error("late discovery failure after startup cancellation"));
      await invocation;
      await setImmediate();
      process.removeListener("unhandledRejection", unhandled);
    }
    expect(failures).toHaveLength(1);
    expect(unhandled).not.toHaveBeenCalled();
    expect(executeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ["doGenerate", "fulfillment"],
    ["doGenerate", "rejection"],
    ["doStream", "fulfillment"],
    ["doStream", "rejection"],
  ] as const)(
    "%s cancels a pending SAP request and handles late %s",
    async (operation, settlement) => {
      const pending = pendingLookup<Awaited<ReturnType<typeof executeRequest>>>();
      vi.mocked(executeRequest).mockReturnValue(pending.promise);
      const caller = new AbortController();
      const added = vi.spyOn(caller.signal, "addEventListener");
      const removed = vi.spyOn(caller.signal, "removeEventListener");
      const source = new Readable({
        read() {
          return;
        },
      });
      const nativeRequest = { destroy: vi.fn() };
      const model = createSAPAIProvider({ api: "responses", destination: config.destination })(
        config.modelId,
      );
      const failures: unknown[] = [];
      const invocation = model[operation]({ ...options, abortSignal: caller.signal }).catch(
        (error: unknown) => failures.push(error),
      );
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      const reason = new Error("stopped while SAP request was pending");
      try {
        await vi.waitFor(() => {
          expect(executeRequest).toHaveBeenCalledTimes(1);
        });
        caller.abort(reason);
        await setImmediate();

        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({
          cause: { cause: reason, name: "AbortError" },
          isRetryable: false,
          statusCode: 499,
        });
        expect(vi.mocked(executeRequest).mock.calls[0]?.[2]?.signal?.aborted).toBe(true);
        expectAbortListenersRemoved(added.mock.calls, removed.mock.calls);
      } finally {
        if (settlement === "fulfillment") {
          pending.resolve({ data: source, headers: {}, request: nativeRequest, status: 200 });
        } else {
          pending.reject(new Error("late SAP request failure"));
        }
        await invocation;
        await setImmediate();
        process.removeListener("unhandledRejection", unhandled);
      }
      if (settlement === "fulfillment") {
        expect(source.destroyed).toBe(true);
        expect(nativeRequest.destroy).toHaveBeenCalled();
      }
      expect(failures).toHaveLength(1);
      expect(unhandled).not.toHaveBeenCalled();
      source.destroy();
    },
  );

  it.each([
    ["doGenerate", 2],
    ["doGenerate", 3],
    ["doStream", 2],
    ["doStream", 3],
  ] as const)(
    "%s releases a response when abort races with SDK fulfillment after %i microtasks",
    async (operation, microtasks) => {
      const caller = new AbortController();
      const reason = new Error("stopped as SAP response arrived");
      const source = new Readable({
        read() {
          return;
        },
      });
      vi.mocked(executeRequest).mockImplementation(() => {
        // Cover cancellation before the transport continuation and before delegate parsing.
        const abortAfterMicrotasks = (remaining: number) => {
          if (remaining === 0) {
            caller.abort(reason);
            return;
          }
          queueMicrotask(() => {
            abortAfterMicrotasks(remaining - 1);
          });
        };
        abortAfterMicrotasks(microtasks);
        return Promise.resolve({ data: source, headers: {}, request: {}, status: 200 });
      });
      const model = createSAPAIProvider({ api: "responses", destination: config.destination })(
        config.modelId,
      );
      try {
        await expect(
          model[operation]({ ...options, abortSignal: caller.signal }),
        ).rejects.toMatchObject({
          cause: { cause: reason, name: "AbortError" },
          isRetryable: false,
          statusCode: 499,
        });
        expect(source.destroyed).toBe(true);
      } finally {
        source.destroy();
      }
    },
  );

  it("cleans a late HTTP failure without registering listeners after cancellation", async () => {
    const pending = pendingLookup<never>();
    const caller = new AbortController();
    let registrations: Parameters<AbortSignal["addEventListener"]>[] = [];
    vi.mocked(executeRequest).mockImplementation((_endpoint, _body, sdkOptions) => {
      const middleware = sdkOptions?.middleware?.[0];
      const signal = sdkOptions?.signal;
      if (!middleware || !signal) throw new Error("Missing SAP transport fixture options.");
      registrations = vi.spyOn(signal, "addEventListener").mock.calls;
      return middleware({
        context: { tenantId: undefined, uri: "https://sap.example.test/responses" },
        fn: () => pending.promise,
      })({ method: "POST" });
    });
    const transport = await createResponsesTransport(
      config,
      {},
      { ...options, abortSignal: caller.signal },
    );
    const failures: unknown[] = [];
    const invocation = transport
      .fetch(`${transport.baseURL}/responses`, request)
      .catch((error: unknown) => failures.push(error));
    caller.abort("stopped before HTTP failure arrived");
    await invocation;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ name: "AbortError" });
    const listenerCount = registrations.length;
    const source = Readable.from(["late failure"]);
    const nativeRequest = { destroy: vi.fn() };
    pending.reject(
      Object.assign(new Error("late HTTP failure"), {
        isAxiosError: true,
        response: { data: source, headers: {}, request: nativeRequest, status: 502 },
      }),
    );
    await setImmediate();

    expect(registrations).toHaveLength(listenerCount);
    expect(nativeRequest.destroy).toHaveBeenCalled();
    expect(source.destroyed).toBe(true);
    expect(failures).toHaveLength(1);
  });
  it("disposes a pending invocation without a caller signal and closes its late response", async () => {
    const pending = pendingLookup<Awaited<ReturnType<typeof executeRequest>>>();
    vi.mocked(executeRequest).mockReturnValue(pending.promise);
    const source = new Readable({
      read() {
        return;
      },
    });
    const nativeRequest = { destroy: vi.fn() };
    const transport = await createResponsesTransport(config, {}, options);
    const reason = new Error("Delegate rejected before receiving a reader");
    const invocation = transport.fetch(`${transport.baseURL}/responses`, request);
    const rejected = expect(invocation).rejects.toMatchObject({
      cause: reason,
      name: "AbortError",
    });

    expect(() => {
      transport.dispose(reason);
    }).not.toThrow();
    expect(() => {
      transport.dispose(new Error("Second disposal"));
    }).not.toThrow();
    await rejected;
    pending.resolve({ data: source, headers: {}, request: nativeRequest, status: 200 });
    await setImmediate();

    expect(source.destroyed).toBe(true);
    expect(nativeRequest.destroy).toHaveBeenCalled();
  });

  it("releases invocation disposal ownership after normal EOF", async () => {
    const transport = await createResponsesTransport(config, {}, options);
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    const signal = vi.mocked(executeRequest).mock.calls[0]?.[2]?.signal;
    await response.text();

    transport.dispose("Already complete");

    expect(signal?.aborted).toBe(false);
  });

  it.each(["classified", "cycle", "deep"] as const)(
    "bounds final HTTP failure inspection at a %s cause chain",
    async (shape) => {
      const source = Readable.from(["Unreachable nested HTTP diagnostic"]);
      const axiosError = Object.assign(new Error("Nested HTTP failure"), {
        isAxiosError: true,
        response: { data: source, headers: {}, request: {}, status: 502 },
      });
      let failure: Error;
      if (shape === "classified") {
        failure = new APICallError({
          cause: axiosError,
          isRetryable: false,
          message: "Already classified",
          requestBodyValues: {},
          statusCode: 400,
          url: "sap-ai:responses",
        });
      } else if (shape === "cycle") {
        failure = new ErrorWithCause("Cyclic wrapper", axiosError);
        Object.defineProperty(failure, "cause", { value: failure });
      } else {
        failure = axiosError;
        for (let depth = 0; depth < 64; depth++) {
          failure = new Error("Bounded native wrapper", { cause: failure });
        }
      }
      const legacyGetter = vi.fn(() => {
        throw new Error("Native cause must take precedence over rootCause");
      });
      Object.defineProperty(failure, "rootCause", { get: legacyGetter });
      vi.mocked(executeRequest).mockImplementation((_endpoint, _body, sdkOptions) => {
        const middleware = sdkOptions?.middleware?.[0];
        if (!middleware) throw new Error("Missing error-preservation middleware");
        return middleware({
          context: { tenantId: undefined, uri: "https://sap.example.test/responses" },
          fn: () => Promise.reject(failure),
        })({ method: "POST" });
      });
      const transport = await createResponsesTransport(config, {}, options);
      try {
        await expect(transport.fetch(`${transport.baseURL}/responses`, request)).rejects.toBe(
          failure,
        );
        expect(legacyGetter).not.toHaveBeenCalled();
      } finally {
        source.destroy();
      }
    },
  );

  it("resolves the model version, destination and actual deployment URL", async () => {
    vi.mocked(getFoundationModelDeploymentId).mockResolvedValue("deployment/with spaces");
    vi.mocked(getAiCoreDestination).mockResolvedValue({ url: "https://sap.example.test" });

    const transport = await createResponsesTransport(config, { modelVersion: "latest" }, options);

    expect(transport.baseURL).toBe(
      "https://sap.example.test/v2/inference/deployments/deployment%2Fwith%20spaces",
    );
    expect(getFoundationModelDeploymentId).toHaveBeenCalledWith(
      { modelName: "gpt-6.1-sol", modelVersion: "latest", resourceGroup: "production" },
      "azure-openai",
      config.destination,
    );
    expect(getAiCoreDestination).toHaveBeenCalledWith(config.destination);
  });

  it("preserves SDK transport settings and merges headers without delegate credentials", async () => {
    const providerSignal = AbortSignal.abort("ignored");
    const caller = new AbortController();
    const httpAgent = { marker: "custom-agent" };
    const middleware: NonNullable<CustomRequestConfig["middleware"]>[number] = ({ fn }) => fn;
    const validateStatus = (status: number) => status < 500;
    const requestConfig: CustomRequestConfig = {
      headers: { "X-Keep": "provider", "X-Override": "provider" },
      httpAgent,
      maxContentLength: 512,
      middleware: [middleware],
      params: { custom: "value" },
      proxy: false,
      signal: providerSignal,
      validateStatus,
    };
    const transport = await createResponsesTransport(
      { ...config, requestConfig },
      {},
      {
        ...options,
        abortSignal: caller.signal,
        headers: { "x-keep": undefined, "x-override": "caller" },
      },
    );

    const response = await transport.fetch(`${transport.baseURL}/responses`, request);

    expect(executeRequest).toHaveBeenCalledWith(
      {
        apiVersion: "2024-10-21",
        resourceGroup: "production",
        url: "/inference/deployments/deployment-1/responses",
      },
      { input: "Hello", store: false },
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
          "x-keep": "provider",
          "x-override": "caller",
        },
        httpAgent,
        maxContentLength: 512,
        params: { custom: "value" },
        proxy: false,
        responseType: "stream",
      }),
      config.destination,
    );
    const forwarded = vi.mocked(executeRequest).mock.calls[0]?.[2];
    expect(forwarded?.middleware).toHaveLength(3);
    expect(forwarded?.middleware?.[1]).toBe(middleware);
    expect(forwarded?.validateStatus).toBe(validateStatus);
    expect(forwarded?.signal).toBeInstanceOf(AbortSignal);
    expect(forwarded?.signal).not.toBe(providerSignal);
    expect(forwarded?.signal?.aborted).toBe(false);
    expect(response.status).toBe(201);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(await response.text()).toBe("firstsecond");
  });

  it("returns raw HTTP responses accepted by the caller's status policy", async () => {
    vi.mocked(executeRequest).mockResolvedValue({
      data: Readable.from(["Gateway unavailable"]),
      headers: { "Retry-After": "7" },
      request: {},
      status: 502,
    });
    const transport = await createResponsesTransport(config, {}, options);

    const response = await transport.fetch(`${transport.baseURL}/responses`, request);

    expect(response.status).toBe(502);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(await response.text()).toBe("Gateway unavailable");
  });

  it("preserves explicitly suppressed authentication headers", async () => {
    const transport = await createResponsesTransport(
      {
        ...config,
        requestConfig: { headers: { Authorization: false } },
      },
      {},
      options,
    );
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    expect(vi.mocked(executeRequest).mock.calls[0]?.[2]?.headers).toMatchObject({
      authorization: false,
    });
    await response.body?.cancel();
  });

  it("does not read upstream bytes before the consumer requests them", async () => {
    const next = vi.fn(() => Promise.resolve({ done: false, value: "chunk" }));
    const finish = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }));
    vi.mocked(executeRequest).mockResolvedValue({
      data: { [Symbol.asyncIterator]: () => ({ next, return: finish }) },
      headers: {},
      request: {},
      status: 200,
    });
    const transport = await createResponsesTransport(config, {}, options);
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    expect(next).not.toHaveBeenCalled();

    const reader = response.body?.getReader();
    expect(await reader?.read()).toEqual({
      done: false,
      value: new TextEncoder().encode("chunk"),
    });
    expect(next).toHaveBeenCalledTimes(1);
    await reader?.cancel();
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("aborts the SDK request and destroys its stream when the consumer cancels", async () => {
    const source = new Readable({
      read() {
        return;
      },
    });
    vi.mocked(executeRequest).mockResolvedValue({
      data: source,
      headers: {},
      request: {},
      status: 200,
    });
    const transport = await createResponsesTransport(config, {}, options);
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    const forwardedSignal = vi.mocked(executeRequest).mock.calls[0]?.[2]?.signal;

    await response.body?.cancel("consumer stopped");

    expect(source.destroyed).toBe(true);
    expect(forwardedSignal?.aborted).toBe(true);
    expect(forwardedSignal?.reason).toBe("consumer stopped");
  });

  it("classifies caller cancellation and preserves its reason while reading", async () => {
    const caller = new AbortController();
    const source = new Readable({
      read() {
        return;
      },
    });
    vi.mocked(executeRequest).mockResolvedValue({
      data: source,
      headers: {},
      request: {},
      status: 200,
    });
    const transport = await createResponsesTransport(
      config,
      {},
      { ...options, abortSignal: caller.signal },
    );
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    const reason = new Error("caller stopped");
    caller.abort(reason);

    await expect(response.text()).rejects.toMatchObject({
      cause: { cause: reason, name: "AbortError" },
      isRetryable: false,
      statusCode: 499,
    });
    expect(source.destroyed).toBe(true);
  });

  it("rejects cancellation before resolving credentials or deployments", async () => {
    const reason = new Error("already stopped");
    await expect(
      createResponsesTransport(config, {}, { ...options, abortSignal: AbortSignal.abort(reason) }),
    ).rejects.toMatchObject({ cause: reason, name: "AbortError" });
    expect(getFoundationModelDeploymentId).not.toHaveBeenCalled();
    expect(getAiCoreDestination).not.toHaveBeenCalled();
  });

  it("preserves cancellation while waiting for the next upstream chunk", async () => {
    const caller = new AbortController();
    const source = new Readable({
      read() {
        return;
      },
    });
    vi.mocked(executeRequest).mockImplementation((_endpoint, _body, sdkOptions) => {
      sdkOptions?.signal?.addEventListener("abort", () => {
        source.destroy(new Error("SDK transport closed"));
      });
      return Promise.resolve({ data: source, headers: {}, request: {}, status: 200 });
    });
    const transport = await createResponsesTransport(
      config,
      {},
      { ...options, abortSignal: caller.signal },
    );
    const response = await transport.fetch(`${transport.baseURL}/responses`, request);
    const result = response.text();
    const rejected = expect(result).rejects.toMatchObject({
      cause: { cause: "stopped while idle", name: "AbortError" },
      statusCode: 499,
    });
    caller.abort("stopped while idle");

    await rejected;
    expect(source.destroyed).toBe(true);
  });

  it.each([
    "https://other.example.test/v2/inference/deployments/deployment-1/responses",
    "https://sap.example.test/v2/inference/deployments/deployment-1/chat/completions",
  ])("rejects requests outside the Responses deployment: %s", async (url) => {
    const transport = await createResponsesTransport(config, {}, options);
    await expect(transport.fetch(url, request)).rejects.toThrow("configured deployment");
    expect(executeRequest).not.toHaveBeenCalled();
  });
});
