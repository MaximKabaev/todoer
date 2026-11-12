"use client";
import { ArrowDownRight, ArrowUpRight, Minus, Check, TriangleAlert } from "lucide-react";
import Link from "next/link";
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
  const activity = entry?.activity;
  const activityText = activity?.active
    ? [
        "Active today",
        ...([
          [activity.completed, "task"],
          [activity.commits, "commit"],
          [activity.merges, "merge"],
        ] as const)
          .filter(([count]) => count > 0)
          .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`),
      ].join(" · ")
    : activity?.atRisk
      ? "No activity yet today · −5 at midnight"
      : "No activity yet today · Nothing assigned";
  const ActivityIcon = activity?.active ? Check : activity?.atRisk ? TriangleAlert : Minus;
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
          {activity && (
            <div className={`${styles.activity} ${activity.active ? styles.active : activity.atRisk ? styles.atRisk : ""}`}>
              <ActivityIcon size={14} aria-hidden="true" />
              <span>{activityText}</span>
            </div>
          )}
          {viewed === "me" && activity && !activity.githubLinked && (
            <Link className={styles.githubHint} href="/settings">
              Connect GitHub in Settings <span aria-hidden="true">↗</span>
            </Link>
          )}
          <div className={styles.stats}>
            {entry.doneThisWeek} done this week
            {entry.afkPenaltyThisWeek > 0 && <span>−{entry.afkPenaltyThisWeek} AFK this week</span>}
            {entry.overdue > 0 && (
              <span className={styles.overdue}>{entry.overdue} overdue</span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
