import { Flame, Trophy } from "lucide-react";

export function completionMilestone(count: number) {
  return count === 3 || count === 5 || (count >= 10 && count % 10 === 0);
}

export function completionMessage(count: number) {
  if (count === 3) return "Hat-trick. Three tasks down!";
  if (count === 5) return "Five down. You’re on fire.";
  if (count >= 10 && count % 10 === 0) return `${count} down. Absolute menace to the backlog.`;
  return ["Nailed it. One less thing.", "Another one bites the dust.", "Look at you getting things done."][(count - 1) % 3];
}

export function CompletionRun({ count }: { count: number }) {
  const target = count <= 3 ? 3 : count <= 5 ? 5 : Math.ceil(count / 10) * 10;
  const reached = count === target;
  return (
    <section className={`completion-run ${reached ? "run-milestone" : ""}`} aria-label="Your victory run">
      <span className="run-icon" aria-hidden="true">{reached ? <Trophy size={21} /> : <Flame size={21} />}</span>
      <div className="run-copy">
        <strong>{reached ? "Victory lap. You earned it." : count ? "Keep the good stuff going." : "Three tasks. Tiny victory lap."}</strong>
        <span>This visit · {count} done · all projects</span>
      </div>
      <div className="run-progress">
        <span>{count}<small> / {target}</small></span>
        <progress max={target} value={count} aria-label="Tasks completed this visit" />
      </div>
    </section>
  );
}
