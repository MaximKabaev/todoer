"use client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { Score } from "@/lib/api";
import { scoreComparison } from "@/lib/score";
import styles from "./score-card.module.css";

export function ScoreCard({
  score,
  viewed,
}: {
  score?: Score;
  viewed: "me" | "teammate";
}) {
  const entry = score?.teammate ? score[viewed] : null;
  const Trend = entry && entry.trend > 0
    ? ArrowUpRight
    : entry && entry.trend < 0 ? ArrowDownRight : Minus;
  return (
    <div className={styles.slot}>
      {entry && score && (
        <section
          className={styles.card}
          aria-label={`${viewed === "me" ? "Your" : entry.user.displayName + "’s"} good boy score`}
        >
          <div>
            <div className={styles.eyebrow}>
              {viewed === "me" ? "Your" : `${entry.user.displayName}’s`} good boy score <span>· All projects</span>
            </div>
            <div className={styles.label}>{entry.label}</div>
            <div className={styles.comparison}>
              {scoreComparison(score, viewed)}
            </div>
          </div>
          <div className={styles.rating}>
            <div className={styles.number}>
              <strong>{entry.score}</strong><span>/100</span>
            </div>
            <div
              className={styles.trend}
              aria-label={`${entry.trend > 0 ? "Up" : entry.trend < 0 ? "Down" : "Unchanged"} ${Math.abs(entry.trend)} points over the last 7 days`}
            >
              <Trend size={14} aria-hidden="true" />
              {entry.trend > 0 ? "+" : ""}{entry.trend} · 7 days
            </div>
          </div>
          <div className={styles.stats}>
            {entry.doneThisWeek} done this week
            {entry.overdue > 0 && (
              <span className={styles.overdue}>{entry.overdue} overdue</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
