"use client";
import {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { Trophy, Timer, ArrowUpRight, Flame, PawPrint, Target, Clock, Sparkles } from "lucide-react";
import { request, type Stats, type PersonStats, type Achievement } from "@/lib/api";
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
const fullDate = (day: string) =>
  new Date(day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const completed = (n: number) => `${n} ${n === 1 ? "task" : "tasks"} completed`;

// Shared interaction and viewport positioning for all chart tooltips. No overlay
// catches events: an outside tap dismisses and still reaches its intended control.
function ChartTooltip({
  id,
  anchor: active,
  label,
}: {
  id: string;
  anchor: { x: number; top: number; bottom: number };
  label: string;
}) {
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  useLayoutEffect(() => {
    if (!active || !bubble.current) return;
    const rect = bubble.current.getBoundingClientRect();
    setPosition({
      left: Math.max(
        8,
        Math.min(innerWidth - rect.width - 8, active.x - rect.width / 2),
      ),
      top: Math.max(
        8,
        Math.min(
          innerHeight - rect.height - 8,
          active.top > rect.height + 16
            ? active.top - rect.height - 8
            : active.bottom + 8,
        ),
      ),
    });
  }, [active, label]);
  return createPortal(
    <div
      ref={bubble}
      id={id}
      role="tooltip"
      aria-live="polite"
      className={styles.chartTooltip}
      style={position}
    >
      {label}
    </div>,
    document.body,
  );
}

function useChartTooltip(labels: string[]) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const [anchor, setAnchor] = useState<{
    index: number;
    x: number;
    top: number;
    bottom: number;
    element: Element;
    offsetX: number;
  } | null>(null);
  const active = anchor && anchor.index < labels.length ? anchor : null;
  function show(index: number, element: Element, x?: number) {
    document.dispatchEvent(
      new CustomEvent("todoer:chart-inspect", { detail: id }),
    );
    const rect = element.getBoundingClientRect();
    setSelected(index);
    setAnchor({
      index,
      x: x ?? rect.left + rect.width / 2,
      top: rect.top,
      bottom: rect.bottom,
      element,
      offsetX: x === undefined ? rect.width / 2 : x - rect.left,
    });
  }
  useEffect(() => {
    const dismiss = () => setAnchor(null);
    const reposition = () =>
      setAnchor((current) => {
        if (!current) return null;
        const rect = current.element.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > innerHeight) return null;
        return {
          ...current,
          x: rect.left + current.offsetX,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
    const outside = (event: PointerEvent) => {
      if (
        !document.getElementById(`${id}-chart`)?.contains(event.target as Node)
      )
        dismiss();
    };
    const inspecting = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) dismiss();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("todoer:chart-inspect", inspecting);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("todoer:chart-inspect", inspecting);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [id]);
  function navigate(event: KeyboardEvent, index: number, column = 1) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      show(index, event.currentTarget);
      return;
    }
    const delta = {
      ArrowRight: column,
      ArrowLeft: -column,
      ArrowDown: 1,
      ArrowUp: -1,
    }[event.key];
    if (delta === undefined && event.key !== "Home" && event.key !== "End")
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? labels.length - 1
          : Math.max(0, Math.min(labels.length - 1, index + delta!));
    const target = event.currentTarget
      .closest("[data-chart-root]")
      ?.querySelectorAll<HTMLElement>("[data-chart-item]")[next];
    target?.focus();
  }
  return {
    rootProps: { id: `${id}-chart`, "data-chart-root": "" },
    selected,
    active,
    show,
    navigate,
    item: (index: number) => ({
      "aria-label": labels[index],
      "aria-describedby": active?.index === index ? id : undefined,
      "data-chart-item": "",
      tabIndex: selected === index ? 0 : -1,
      onFocus: (event: React.FocusEvent<HTMLElement>) =>
        show(index, event.currentTarget),
      onClick: (event: React.MouseEvent<HTMLElement>) =>
        show(index, event.currentTarget),
      onPointerEnter: (event: React.PointerEvent<HTMLElement>) => {
        if (event.pointerType === "mouse") show(index, event.currentTarget);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => navigate(event, index),
    }),
    dismiss: {
      onPointerLeave: (event: React.PointerEvent) => {
        if (
          event.pointerType === "mouse" &&
          !event.currentTarget.contains(document.activeElement)
        )
          setAnchor(null);
      },
      onBlur: (event: React.FocusEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setAnchor(null);
      },
    },
    tooltip: active ? (
      <ChartTooltip id={id} anchor={active} label={labels[active.index]} />
    ) : null,
  };
}

// Flip only once the complete catalog has been placed in public/achievements.
const ACHIEVEMENT_ART_READY = false;
const achievementArtPath = (id: string) => `/achievements/${id}.png`;
const achievementCategories = [
  { id: "score", title: "Score", color: "purple", Icon: Target },
  { id: "streak", title: "Streaks", color: "orange", Icon: Flame },
  { id: "volume", title: "Getting things done", color: "teal", Icon: PawPrint },
  { id: "punctuality", title: "Right on time", color: "blue", Icon: Clock },
  { id: "competition", title: "Friendly competition", color: "orange", Icon: Trophy },
  { id: "fun", title: "Little victories", color: "purple", Icon: Sparkles },
] as const;

function Achievements({ data }: { data: Stats }) {
  const [selected, setSelected] = useState<"me" | "teammate">("me");
  const person = selected === "teammate" && data.teammate ? "teammate" : "me";
  const entries = data.achievements;
  const earned = (key: "me" | "teammate") =>
    entries.filter((entry) => entry[key]?.unlocked).length;
  const status = (entry: Achievement) => {
    const state = entry[person];
    return state?.unlocked
      ? `Earned${state.unlockedAt ? ` ${date(state.unlockedAt)}` : ""}`
      : state?.progress
        ? `Locked · ${state.progress.current}/${state.progress.target}`
        : "Locked";
  };
  const tip = useChartTooltip(
    entries.map((entry) => `${entry.title} · ${entry.description} · ${status(entry)}`),
  );
  return (
    <section className={styles.panel} aria-labelledby="achievements-title">
      <div className={styles.sectionHead}>
        <div>
          <span className={styles.kicker}>A LITTLE PROOF OF PROGRESS</span>
          <h2 id="achievements-title">Achievements</h2>
          <p className={styles.note} data-testid="achievement-counts">
            {data.me.user.displayName} {earned("me")}/{entries.length}
            {data.teammate &&
              ` · ${data.teammate.user.displayName} ${earned("teammate")}/${entries.length}`} · earned
          </p>
        </div>
        <div className={styles.switch} role="group" aria-label="Achievement person">
          {(["me", "teammate"] as const).map((key) => data[key] && (
            <button key={key} aria-pressed={person === key} onClick={() => setSelected(key)}>
              {data[key]!.user.displayName}
            </button>
          ))}
        </div>
      </div>
      <div
        {...tip.rootProps}
        {...tip.dismiss}
        role="group"
        aria-label={`${data[person]!.user.displayName} achievements`}
      >
        {achievementCategories.map(({ id, title, color, Icon }) => (
          <div
            className={styles.achievementCategory}
            key={id}
            style={{ "--badge": `var(--${color})` } as CSSProperties}
          >
            <h3>{title}</h3>
            <div className={styles.achievementGrid}>
              {entries.filter((entry) => entry.category === id).map((entry) => {
                const state = entry[person];
                const index = entries.indexOf(entry);
                return (
                  <div
                    key={entry.id}
                    data-testid="achievement-badge"
                    data-achievement={entry.id}
                    data-unlocked={!!state?.unlocked}
                    className={styles.achievement}
                    {...tip.item(index)}
                    role="group"
                  >
                    <div className={styles.achievementArt} aria-hidden="true">
                      {ACHIEVEMENT_ART_READY ? (
                        // The fixed slots accommodate the final badge illustrations without layout changes.
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={achievementArtPath(entry.id)} alt="" width={64} height={64} />
                      ) : (
                        <span className={styles.medallion}>
                          <Icon size={27} strokeWidth={1.6} />
                        </span>
                      )}
                    </div>
                    <h4>{entry.title}</h4>
                    <p>{entry.description}</p>
                    <span className={styles.achievementStatus}>{status(entry)}</span>
                    {!state?.unlocked && state?.progress && (
                      <progress
                        aria-label={`${entry.title} progress`}
                        value={state.progress.current}
                        max={state.progress.target}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {tip.tooltip}
      </div>
    </section>
  );
}

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
  const historyLabels = history.map(
    (h) =>
      `${fullDate(h.day)} · ${data.me.user.displayName}: ${h.me ?? "No score"}${data.teammate ? ` · ${data.teammate.user.displayName}: ${h.teammate ?? "No score"}` : ""}`,
  );
  const tip = useChartTooltip(historyLabels);
  const x = (i: number) =>
    history.length < 2
      ? width / 2
      : 42 + (i / (history.length - 1)) * (right - 42);
  const y = (score: number) => 190 - score * 1.6;
  function inspect(element: Element, clientX: number) {
    if (!history.length) return;
    const rect = element.getBoundingClientRect();
    const local = ((clientX - rect.left) * width) / rect.width;
    const i = Math.max(
      0,
      Math.min(
        history.length - 1,
        Math.round(((local - 42) / (right - 42)) * (history.length - 1)),
      ),
    );
    tip.show(i, element, rect.left + (x(i) * rect.width) / width);
  }
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
        <div
          {...tip.rootProps}
          role="group"
          tabIndex={history.length ? 0 : -1}
          aria-label={
            tip.active
              ? historyLabels[tip.active.index]
              : "Explore score history. Use arrow keys to move between days."
          }
          {...tip.dismiss}
          onFocus={(event) => {
            if (history.length) {
              const i = Math.min(tip.selected, history.length - 1);
              const rect = event.currentTarget.getBoundingClientRect();
              tip.show(
                i,
                event.currentTarget,
                rect.left + (x(i) * rect.width) / width,
              );
            }
          }}
          onKeyDown={(event) => {
            if (
              !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) ||
              !history.length
            )
              return;
            event.preventDefault();
            const i =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? history.length - 1
                  : Math.max(
                      0,
                      Math.min(
                        history.length - 1,
                        tip.selected + (event.key === "ArrowLeft" ? -1 : 1),
                      ),
                    );
            const rect = event.currentTarget.getBoundingClientRect();
            tip.show(
              i,
              event.currentTarget,
              rect.left + (x(i) * rect.width) / width,
            );
          }}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse")
              inspect(event.currentTarget, event.clientX);
          }}
          onClick={(event) => inspect(event.currentTarget, event.clientX)}
        >
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
                          />
                        ),
                    )}
                  </g>
                ),
            )}
            {tip.active && (
              <line
                data-testid="history-guide"
                x1={x(tip.active.index)}
                x2={x(tip.active.index)}
                y1="22"
                y2="195"
                stroke="var(--secondary)"
                strokeDasharray="3 3"
                pointerEvents="none"
              />
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
        {tip.tooltip}
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
  const weekdays = [
    "Mondays",
    "Tuesdays",
    "Wednesdays",
    "Thursdays",
    "Fridays",
    "Saturdays",
    "Sundays",
  ];
  const tip = useChartTooltip(
    values.map(
      (v, i) =>
        `${values.length === 7 ? weekdays[i] : `${String(i).padStart(2, "0")}:00–${String(i + 1).padStart(2, "0")}:00`} · ${completed(v)}`,
    ),
  );
  return (
    <div
      className={styles.bars}
      {...tip.rootProps}
      role="group"
      aria-label={name}
      {...tip.dismiss}
    >
      {values.map((v, i) => (
        <div key={i}>
          <div className={styles.barTrack} role="button" {...tip.item(i)}>
            <span style={{ height: `${(v / max) * 100}%` }} />
          </div>
          <small>{values.length === 7 || i % 6 === 0 ? labels[i] : ""}</small>
        </div>
      ))}
      {tip.tooltip}
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
  const tip = useChartTooltip(
    person.activity.map((a) =>
      [
        fullDate(a.day),
        ...[
          a.completed && completed(a.completed),
          a.commits && `${a.commits} ${a.commits === 1 ? "commit" : "commits"}`,
          a.merges && `${a.merges} merged ${a.merges === 1 ? "PR" : "PRs"}`,
        ].filter(Boolean),
      ]
        .concat(a.completed + a.commits + a.merges ? [] : ["No activity"])
        .join(" · "),
    ),
  );
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
        {...tip.rootProps}
        role="group"
        aria-label={`${person.user.displayName} daily activity heatmap. Use up and down for days, left and right for weeks.`}
        {...tip.dismiss}
      >
        {person.activity.map((a, i) => {
          const n = a.completed + a.commits + a.merges;
          return (
            <span
              key={a.day}
              style={{
                background: n
                  ? `color-mix(in srgb, var(--person) ${Math.min(100, 25 + n * 12)}%, var(--surface))`
                  : "var(--surface)",
              }}
              role="button"
              {...tip.item(i)}
              onKeyDown={(event) => tip.navigate(event, i, 7)}
            />
          );
        })}
      </div>
      {tip.tooltip}
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
      <Achievements data={data} />
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
