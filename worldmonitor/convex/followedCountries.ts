/**
 * Lemma trim stub — type-only exports for frontend `followed-countries.ts`.
 * Full Convex implementation removed; lemma minimal Docker stack does not deploy Convex.
 */

export type FollowMutationResult =
  | { ok: true; idempotent: false }
  | { ok: true; idempotent: true }
  | { ok: false; reason: "FREE_CAP"; currentCount: number; limit: number };

export type MergeAnonymousLocalResult = {
  totalCount: number;
  accepted: string[];
  droppedInvalid: string[];
  droppedDueToCap: string[];
};
