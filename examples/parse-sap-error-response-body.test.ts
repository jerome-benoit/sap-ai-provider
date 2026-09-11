import { describe, expect, it } from "vitest";

import { parseSAPErrorResponseBody } from "./parse-sap-error-response-body.js";

describe("example SAP error diagnostics", () => {
  it("ignores non-JSON gateway responses instead of replacing the API error", () => {
    expect(parseSAPErrorResponseBody("<html>Bad Gateway</html>")).toBeUndefined();
  });

  it("ignores JSON null instead of accessing an error property on it", () => {
    expect(parseSAPErrorResponseBody("null")).toBeUndefined();
  });

  it("retains numeric SAP error codes while ignoring malformed optional fields", () => {
    const details = parseSAPErrorResponseBody(
      JSON.stringify({ error: { code: 400, message: {}, request_id: "request-123" } }),
    );

    expect(details?.error).toEqual({
      code: 400,
      message: undefined,
      request_id: "request-123",
    });
  });
});
