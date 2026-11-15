"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import useSWR from "swr";
import { Trophy, Timer, ArrowUpRight, Flame } from "lucide-react";
import { request, type Stats, type PersonStats } from "@/lib/api";
import { seasonOutcome } from "@/lib/seasons";
import styles from "./stats-dashboard.module.css";

const date = (day: string) =>
  new Date(day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
const accent = (person: PersonStats): CSSProperties =>
  ({ "--person": `var(--${person.user.color})` }) as CSSProperties;
function History({ data }: { data: Stats }) {
  const [range, setRange] = useState(30);
  // Draw at the container's real width so the chart keeps its height and legible labels on phones.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(780);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const right = width - 42;
  const history = range ? data.history.slice(-range) : data.history;
  const x = (i: number) =>
    history.length < 2
      ? width / 2
      : 42 + (i / (history.length - 1)) * (right - 42);
  const y = (score: number) => 190 - score * 1.6;
  const people = [data.me, data.teammate].filter((p): p is PersonStats => !!p);
  return (
    <section className={styles.panel} aria-labelledby="history-title">
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.kicker}>THE LONG GAME</span>
          <h2 id="history-title">Score history</h2>
        </div>
        <div className={styles.switch} aria-label="History range">
          {[
            [30, "30 days"],
            [90, "90 days"],
            [0, "All"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={range === value}
              onClick={() => setRange(Number(value))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.legend}>
        {people.map((p) => (
          <span key={p.user.id} style={accent(p)}>
            <i />
            {p.user.displayName}
          </span>
        ))}
        <small>End-of-day · /100</small>
      </div>
      <div ref={frame}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${width} 232`}
          role="img"
          aria-label="Score history chart: end-of-day scores, 0 to 100"
        >
          {[0, 25, 50, 75, 100].map((n) => (
            <g key={n}>
              <line
                x1="42"
                x2={right}
                y1={y(n)}
                y2={y(n)}
                stroke="var(--line-strong)"
                strokeDasharray={n === 50 ? "4 4" : undefined}
              />
              <text x="28" y={y(n) + 4} textAnchor="end">
                {n}
              </text>
            </g>
          ))}
          {history.map(
            (h, i) =>
              h.day.endsWith("-01") && (
                <g key={h.day}>
                  <line
                    x1={x(i)}
                    x2={x(i)}
                    y1="22"
                    y2="195"
                    stroke="var(--secondary)"
                    strokeDasharray="3 5"
                  />
                  <text x={x(i)} y="14" textAnchor="middle">
                    {new Date(h.day).toLocaleDateString("en-US", {
                      month: "short",
                      timeZone: "UTC",
                    })}{" "}
                    · season
                  </text>
                </g>
              ),
          )}
          {(["me", "teammate"] as const).map(
            (key, pi) =>
              data[key] && (
                <g key={key} style={accent(data[key]!)}>
                  <polyline
                    points={history
                      .map((h, i) =>
                        h[key] === null ? "" : `${x(i)},${y(h[key]!)}`,
                      )
                      .join(" ")}
                    fill="none"
                    stroke="var(--person)"
                    strokeWidth="3"
                    strokeLinejoin="round"
                    strokeDasharray={pi ? "6 4" : undefined}
                  />
                  {history.map(
                    (h, i) =>
                      h[key] !== null && (
                        <circle
                          key={h.day}
                          cx={x(i)}
                          cy={y(h[key]!)}
                          r={history.length < 3 ? 5 : 2}
                          fill="var(--person)"
                        >
                          <title>
                            {date(h.day)} · {data[key]!.user.displayName}:{" "}
                            {h[key]}
                          </title>
                        </circle>
                      ),
                  )}
                </g>
              ),
          )}
          {history.length > 0 && (
            <>
              <text x="42" y="222">
                {date(history[0].day)}
              </text>
              <text x={right} y="222" textAnchor="end">
                {date(history.at(-1)!.day)}
              </text>
            </>
          )}
        </svg>
      </div>
      {history.length < 3 && (
        <p className={styles.note}>
          The story starts here. Each day adds another point to the chart.
        </p>
      )}
    </section>
  );
}
function HeadToHead({ data }: { data: Stats }) {
  const [period, setPeriod] = useState<"season" | "allTime">("season");
  const people = [data.me, data.teammate];
  const rows: [string, (p: PersonStats) => string | number][] = [
    ["Completed", (p) => p[period].completed],
    [
      "On-time rate",
      (p) =>
        p[period].onTimeRate === null
          ? "—"
          : `${Math.round(p[period].onTimeRate! * 100)}%`,
    ],
    ["Active days", (p) => p[period].activeDays],
    ...(period === "season"
      ? [
          ["Days led", (p: PersonStats) => p.season.daysLed] as [
            string,
            (p: PersonStats) => number,
          ],
        ]
      : []),
    ["AFK days", (p) => p[period].afkDays],
    [
      "AFK points lost",
      (p) => (p[period].afkPoints ? `−${p[period].afkPoints}` : 0),
    ],
    ["Commits", (p) => p[period].commits],
    ["Merged PRs", (p) => p[period].merges],
    ...(period === "allTime"
      ? ([
          [
            "Median hours to done",
            (p: PersonStats) =>
              p.allTime.medianHoursToDone === null
                ? "—"
                : `${p.allTime.medianHoursToDone.toFixed(1)}h`,
          ],
          ["Tasks created", (p: PersonStats) => p.allTime.created],
          [
            "Assigned to teammate",
            (p: PersonStats) => p.allTime.assignedToTeammate,
          ],
        ] as [string, (p: PersonStats) => string | number][])
      : []),
  ];
  return (
    <section className={styles.panel}>
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.kicker}>FRIENDLY RIVALRY</span>
          <h2>Head to head</h2>
        </div>
        <div className={styles.switch}>
          <button
            aria-pressed={period === "season"}
            onClick={() => setPeriod("season")}
          >
            This season
          </button>
          <button
            aria-pressed={period === "allTime"}
            onClick={() => setPeriod("allTime")}
          >
            All time
          </button>
        </div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">The numbers</th>
            {people.map((p, i) => (
              <th scope="col" key={i} style={p ? accent(p) : undefined}>
                {p?.user.displayName || "Teammate"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              {people.map((p, i) => (
                <td key={i}>{p ? value(p) : "—"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.note}>
        {period === "season"
          ? "Days led count finished days. Switch to All time for task creation and turnaround."
          : "Turnaround and task creation are measured across all time."}{" "}
        A dash means no data yet.
      </p>
    </section>
  );
}
function Bars({
  values,
  labels,
  name,
}: {
  values: number[];
  labels: string[];
  name: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div
      className={styles.bars}
      role="img"
      aria-label={`${name}: ${values.map((v, i) => `${labels[i]}: ${v}`).join(", ")}`}
    >
      {values.map((v, i) => (
        <div key={i}>
          <div className={styles.barTrack}>
            <span
              style={{ height: `${(v / max) * 100}%` }}
              title={`${labels[i]}: ${v} completions`}
            />
          </div>
          <small>{values.length === 7 || i % 6 === 0 ? labels[i] : ""}</small>
        </div>
      ))}
    </div>
  );
}
function PersonPanel({
  person,
  timezone,
}: {
  person: PersonStats;
  timezone: string;
}) {
  const records = [
    [
      "Active streak",
      days(person.streak.current),
      `Personal best · ${days(person.streak.best)}`,
    ],
    [
      "Highest score",
      person.best?.score ?? "—",
      person.best ? date(person.best.day) : "No history yet",
    ],
    [
      "Lowest score",
      person.worst?.score ?? "—",
      person.worst ? date(person.worst.day) : "No history yet",
    ],
    [
      "Best day",
      person.bestDay ? `${person.bestDay.completed} done` : "—",
      person.bestDay ? date(person.bestDay.day) : "Your best is ahead",
    ],
  ];
  return (
    <section
      className={`${styles.panel} ${styles.personPanel}`}
      style={accent(person)}
      aria-label={`${person.user.displayName} activity and records`}
    >
      <div className={styles.sectionHead}>
        <h2>
          <i className={styles.dot} />
          {person.user.displayName}
        </h2>
        <Flame size={19} color="var(--person)" aria-hidden="true" />
      </div>
      <div className={styles.records}>
        {records.map(([label, value, sub]) => (
          <div key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <small>{sub}</small>
          </div>
        ))}
      </div>
      <h3>Showing up adds up</h3>
      <p className={styles.note}>
        Last 182 days · tasks + commits + merged PRs
      </p>
      <div
        className={styles.heatmap}
        role="img"
        aria-label={`${person.user.displayName} daily activity heatmap`}
      >
        {person.activity.map((a) => {
          const n = a.completed + a.commits + a.merges;
          return (
            <span
              key={a.day}
              style={{
                background: n
                  ? `color-mix(in srgb, var(--person) ${Math.min(100, 25 + n * 12)}%, var(--surface))`
                  : "var(--surface)",
              }}
              title={`${date(a.day)}: ${a.completed} completed, ${a.commits} commits, ${a.merges} merges`}
            />
          );
        })}
      </div>
      <div className={styles.heatLegend}>
        <span>
          {person.activity[0]
            ? date(person.activity[0].day)
            : "No activity yet"}
        </span>
        <span>
          Less <i />
          <i />
          <i /> More
        </span>
        <span>Today</span>
      </div>
      <h3>When things get done</h3>
      <p className={styles.note}>All-time completions · {timezone}</p>
      <Bars
        name="Completions by weekday"
        values={person.weekdays}
        labels={["M", "Tu", "W", "Th", "F", "Sa", "Su"]}
      />
      <Bars
        name="Completions by hour"
        values={person.hours}
        labels={Array.from({ length: 24 }, (_, i) => `${i}:00`)}
      />
    </section>
  );
}
export function StatsDashboard() {
  const { data, error, mutate } = useSWR<Stats>("/api/stats", request, {
    refreshInterval: 60000,
  });
  if (!data)
    return (
      <div className={styles.dashboard} role={error ? "alert" : "status"}>
        {error ? (
          <>
            <h1>Stats need a moment</h1>
            <button className="text-button" onClick={() => void mutate()}>
              Try again
            </button>
          </>
        ) : (
          "Gathering the good stuff…"
        )}
      </div>
    );
  const { me, teammate, season } = data;
  const leader =
    !teammate || me.score === teammate.score
      ? null
      : me.score > teammate.score
        ? me
        : teammate;
  return (
    <div className={styles.dashboard}>
      <div className={styles.pageHead}>
        <div>
          <span className={styles.kicker}>A LITTLE HEALTHY COMPETITION</span>
          <h1>
            Stats<span>.</span>
          </h1>
        </div>
        <span className={styles.scope}>All projects · {data.timezone}</span>
      </div>
      <section className={styles.hero} aria-label="Season standings">
        <div className={styles.sectionHead}>
          <span className={styles.seasonBadge}>
            <Trophy size={15} /> Season {season.number} · {season.name}
          </span>
          <span className={styles.countdown} title={season.endsAt}>
            <Timer size={14} />
            {season.daysLeft === 1
              ? "Last day!"
              : `${days(season.daysLeft)} left`}
          </span>
        </div>
        <h2>
          {!teammate ? (
            "Your season. Your pace."
          ) : leader ? (
            <>
              {leader.user.displayName} leads by{" "}
              {Math.abs(me.score - teammate.score)}
              <ArrowUpRight size={27} />
            </>
          ) : (
            "Neck and neck."
          )}
        </h2>
        <p className={styles.heroCopy}>
          {teammate
            ? "A fresh month. A friendly rivalry. Every good day counts."
            : "Keep showing up. Your progress counts here."}
        </p>
        <div className={styles.standings}>
          {[me, teammate].map((p, i) =>
            p ? (
              <div key={p.user.id} style={accent(p)}>
                <div className={styles.personName}>
                  <i className={styles.dot} />
                  {p.user.displayName}
                  {i === 0 && <small>you</small>}
                </div>
                <strong>
                  {p.score}
                  <small>/100</small>
                </strong>
                <div className={styles.scoreTrack}>
                  <span style={{ width: `${p.score}%` }} />
                </div>
                <small>{p.label}</small>
              </div>
            ) : (
              <div key="absent" className={styles.note}>
                Waiting for a teammate
              </div>
            ),
          )}
        </div>
        <div className={styles.tally}>
          <span>OVERALL TALLY</span>
          <strong>
            {me.user.displayName} {season.tally.me} <span>–</span>{" "}
            {season.tally.teammate} {teammate?.user.displayName || "Teammate"}
          </strong>
          <small>
            {season.tally.ties} {season.tally.ties === 1 ? "tie" : "ties"} ·
            Ends{" "}
            {new Date(season.endsAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: data.timezone,
            })}{" "}
            ({data.timezone})
          </small>
        </div>
        {season.previous && (
          <p className={styles.previous}>
            Last season:{" "}
            <strong>
              {seasonOutcome(
                season.previous,
                me.user.displayName,
                teammate?.user.displayName,
              )}
            </strong>{" "}
            · {season.previous.me.score}–
            {season.previous.teammate?.score ?? "—"}. Starting scores this
            season: {me.user.displayName} {season.previous.me.carriedOver}
            {teammate &&
              ` · ${teammate.user.displayName} ${season.previous.teammate?.carriedOver ?? "—"}`}
            .
          </p>
        )}
      </section>
      <History data={data} />
      <HeadToHead data={data} />
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.kicker}>CONSISTENCY IS THE FLEX</span>
          <h2>Streaks, records & rhythm</h2>
        </div>
      </div>
      <div className={styles.peopleGrid}>
        <PersonPanel person={me} timezone={data.timezone} />
        {teammate && <PersonPanel person={teammate} timezone={data.timezone} />}
      </div>
      <section className={styles.panel}>
        <div className={styles.sectionHead}>
          <div>
            <span className={styles.kicker}>THE HALL OF GOOD BOYS</span>
            <h2>Past seasons</h2>
          </div>
          <Trophy size={20} color="var(--orange)" />
        </div>
        {data.seasons.length ? (
          data.seasons.map((s) => (
            <div className={styles.pastSeason} key={s.id}>
              <div>
                <strong>Season {s.number}</strong>
                <small>{s.name}</small>
              </div>
              <span>
                {seasonOutcome(
                  s,
                  me.user.displayName,
                  teammate?.user.displayName,
                )}
              </span>
              <strong
                title={`${me.user.displayName} · ${teammate?.user.displayName || "Teammate"}`}
              >
                {s.me.score} <span>–</span> {s.teammate?.score ?? "—"}
              </strong>
            </div>
          ))
        ) : (
          <p className={styles.note}>
            The first chapter is still being written. Finished seasons will live
            here.
          </p>
        )}
      </section>
      <p className={styles.footer}>
        A new season starts on the 1st. Scores move halfway back to 50; the
        memories stay.
      </p>
    </div>
  );
}
