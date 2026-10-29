import { useEffect, useRef, useState } from 'react';

export interface LinePoint {
  label: string;
  percent: number | null;
}

const HEIGHT = 190;
const PAD_LEFT = 42;
const PAD_RIGHT = 14;
const PAD_TOP = 14;
const PAD_BOTTOM = 28;
const MAX_X_LABELS = 12;

const TICKS = [0, 25, 50, 75, 100];

export default function LineChart({ points }: { points: LinePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    setWidth(Math.round(element.clientWidth));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (points.length === 0) {
    return (
      <p className="muted small line-chart-empty">
        Histórico insuficiente para exibir a evolução semanal.
      </p>
    );
  }

  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT);
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const x = (index: number) =>
    PAD_LEFT + (points.length <= 1 ? 0 : (index * plotWidth) / (points.length - 1));
  const y = (percent: number) => PAD_TOP + plotHeight - (percent / 100) * plotHeight;

  const lastPlottedIndex = points.reduce(
    (last, point, index) => (point.percent !== null ? index : last),
    -1,
  );
  const plottedPoints = points.slice(0, lastPlottedIndex + 1);
  const linePoints = plottedPoints
    .map((point, index) => `${x(index)},${y(point.percent as number)}`)
    .join(' ');

  const labelStep = Math.ceil(points.length / MAX_X_LABELS);

  return (
    <div className="line-chart" ref={containerRef}>
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Evolução semanal do progresso do projeto"
        >
          {TICKS.map((tick) => (
            <g key={tick}>
              <line
                className="line-chart-grid"
                x1={PAD_LEFT}
                x2={width - PAD_RIGHT}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="line-chart-tick"
                x={PAD_LEFT - 8}
                y={y(tick) + 4}
                textAnchor="end"
              >
                {tick}%
              </text>
            </g>
          ))}
          {lastPlottedIndex > 0 && (
            <polyline className="line-chart-line" points={linePoints} fill="none" />
          )}
          {plottedPoints.map((point, index) => (
            <circle
              key={`dot-${index}`}
              className="line-chart-dot"
              cx={x(index)}
              cy={y(point.percent as number)}
              r="4"
            />
          ))}
          {points.map((point, index) =>
            index % labelStep === 0 ||
            index === points.length - 1 ||
            point.label === 'Atual' ? (
              <text
                key={`label-${index}`}
                className="line-chart-x"
                x={x(index)}
                y={HEIGHT - 8}
                textAnchor="middle"
              >
                {point.label}
              </text>
            ) : null,
          )}
        </svg>
      )}
    </div>
  );
}
