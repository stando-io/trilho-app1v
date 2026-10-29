export function scoreTone(score: number | null): string {
  if (score === null) return 'neutral';
  if (score >= 7) return 'ok';
  if (score >= 4) return 'warn';
  return 'low';
}

export default function ScoreBar({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="muted small">sem notas</span>;
  }
  const width = Math.round((score / 10) * 100);
  return (
    <span className="progress-wrap" aria-label={`Índice ${score} de 10`}>
      <span className="progress">
        <span
          className={`progress-fill progress-${scoreTone(score)}`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="progress-label">{score.toFixed(1).replace('.0', '')}/10</span>
    </span>
  );
}
