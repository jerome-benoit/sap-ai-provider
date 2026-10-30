/** Private metadata for lossless round trips through the shared V3 contract. */
import type { LanguageModelV3FinishReason, LanguageModelV4FinishReason } from "@ai-sdk/provider";

// Static CommonJS facades and lazily loaded ESM strategies must share this identity.
export const ORIGINAL_V4_FINISH_REASON = Symbol.for(
  "@jerome-benoit/sap-ai-provider/adapter-metadata.originalV4FinishReason",
);

export type FinishReasonWithV4Metadata = LanguageModelV3FinishReason & {
  [ORIGINAL_V4_FINISH_REASON]?: LanguageModelV4FinishReason;
};
