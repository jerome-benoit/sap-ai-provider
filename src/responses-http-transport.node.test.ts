/** SAP HTTP transport contracts for Responses requests and response cancellation. */
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { CustomRequestConfig } from "@sap-ai-sdk/core";

import { getFoundationModelDeploymentId } from "@sap-ai-sdk/ai-api/internal.js";
import { executeRequest, getAiCoreDestination } from "@sap-ai-sdk/core";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LanguageModelStrategyConfig } from "./sap-ai-strategy.js";

import { createResponsesTransport } from "./responses-http-transport.js";

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
    expect(forwarded?.middleware).toHaveLength(2);
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
