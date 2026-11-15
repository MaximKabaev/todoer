import type { SeasonResult } from "./api";

export function seasonOutcome(
  result: SeasonResult,
  me: string,
  teammate?: string,
) {
  return result.winner === null
    ? "A tie"
    : `${result.winner === "me" ? me : teammate || "Teammate"} won`;
}
