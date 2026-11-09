import type { Score } from "./api";

export function scoreComparison(score: Score, viewed: "me" | "teammate") {
  const name = score.teammate?.user.displayName || "Teammate";
  if (!score.leader) return "Neck and neck";
  if (score.leader === "me") return `You lead ${name} by ${score.lead}`;
  return `${name} leads${viewed === "teammate" ? " you" : ""} by ${score.lead}`;
}
