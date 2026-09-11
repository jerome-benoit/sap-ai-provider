import { z } from "zod";

const sapErrorResponseBodySchema = z.object({
  error: z.object({
    code: z.union([z.string(), z.number()]).optional().catch(undefined),
    message: z.string().optional().catch(undefined),
    request_id: z.string().optional().catch(undefined),
  }),
});

/**
 * Parses optional SAP details without replacing the original API error when its
 * response body is plain text, malformed JSON, or a different JSON shape.
 * @param responseBody - Raw API response body from APICallError.
 * @returns Validated SAP error details, or undefined when unavailable.
 */
export function parseSAPErrorResponseBody(
  responseBody: string | undefined,
): undefined | z.infer<typeof sapErrorResponseBodySchema> {
  if (!responseBody) {
    return undefined;
  }

  try {
    const parsedResponseBody: unknown = JSON.parse(responseBody);
    return sapErrorResponseBodySchema.parse(parsedResponseBody);
  } catch {
    return undefined;
  }
}
