/**
 * Single time origin for all mock data. Defaults to the real clock so the
 * SPA always shows fresh relative timestamps; the fixture export script sets
 * MOCK_NOW (epoch ms) so regenerated JSON is deterministic and git-stable.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

const override =
  typeof process !== "undefined" ? process.env?.MOCK_NOW : undefined;

export const now = override ? Number(override) : Date.now();
