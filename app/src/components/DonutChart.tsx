export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

const PALETTE = ['#5b4fe9', '#f59e0b', '#16a34a', '#ef4444', '#0ea5e9', '#98a2ad', '#8b5cf6', '#14b8a6'];

const SIZE = 168;
const STROKE = 24;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function donutColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export default function DonutChart({ slices, total }: { slices: DonutSlice[]; total: number }) {
  if (total <= 0) {
    return <p className="muted">Nenhum card para exibir.</p>;
  }

  let offset = 0;
  const segments = slices.map((slice) => {
    const length = (slice.value / total) * CIRCUMFERENCE;
    const segment = (
      <circle
        key={slice.label}
        className="donut-seg"
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={RADIUS}
        stroke={slice.color}
        strokeDasharray={`${length} ${CIRCUMFERENCE - length}`}
        strokeDashoffset={-offset}
      />
    );
    offset += length;
    return segment;
  });

  return (
    <div className="donut">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={`Distribuição por status, ${total} cards`}
      >
        <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
          <circle
            className="donut-track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
          />
          {segments}
        </g>
      </svg>
      <div className="donut-center" aria-hidden="true">
        <strong>{total}</strong>
        <span>cards</span>
      </div>
    </div>
  );
}
