export function progressTone(percent: number | null): string {
  if (percent === null) return 'neutral';
  if (percent >= 66) return 'ok';
  if (percent >= 33) return 'warn';
  return 'low';
}

export default function ProgressBar({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <span className="muted small">sem cards</span>;
  }
  return (
    <span className="progress-wrap" aria-label={`Progresso ${percent}%`}>
      <span className="progress">
        <span
          className={`progress-fill progress-${progressTone(percent)}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="progress-label">{percent}%</span>
    </span>
  );
}
