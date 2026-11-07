import { useEffect, useRef } from 'react';

const STATION_X = [80, 240, 400, 560, 720];
const STATION_NAMES = ['Nova solicitação', 'Em análise', 'Em andamento', 'Em observação', 'Concluído'];
const STATION_DESCS = [
  'O pedido nasce com código e prioridade.',
  'A equipe define responsável e prazo.',
  'O técnico assume e registra o trabalho.',
  'Nota de 0 a 10 sobre a absorção do setor.',
  'A demanda fecha e entra nos relatórios.',
];
const WAGON_LOADS = ['#e34948', '#2a78d6', '#eda100', '#6250d6', '#1baf7a'];
const LOCO_WHEELS = [-21, -5, 11];

const ENTRY = 1.6;
const DWELL = 2.4;
const MOVE = 1.4;
const EXIT = 3.0;
const LEAD = 0.45;
const FROM_X = -70;
const TO_X = 1090;
const EASE = 'cubic-bezier(0.4,0,0.2,1)';

function Wheel({ cx }: { cx: number }) {
  return (
    <>
      <circle cx={cx} cy={51} r={5} fill="#FA7A2F" />
      <line
        className="lt-spin"
        x1={cx - 3.5}
        y1={51}
        x2={cx + 3.5}
        y2={51}
        stroke="#12213E"
        strokeWidth={1.5}
      />
    </>
  );
}

export default function TrainIllustration() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trainRef = useRef<SVGGElement>(null);
  const stationsRef = useRef<SVGGElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<((index: number) => void) | null>(null);

  useEffect(() => {
    const train = trainRef.current;
    const wrap = wrapRef.current;
    const stationsHost = stationsRef.current;
    const labelsHost = labelsRef.current;
    if (!train || !wrap || !stationsHost || !labelsHost) return;
    if (typeof train.animate !== 'function') return;

    const arrive: number[] = [];
    const depart: number[] = [];
    const points: { x: number; time: number; easing: string }[] = [];
    let cursor = 0;

    points.push({ x: FROM_X, time: 0, easing: EASE });
    cursor += ENTRY;
    for (let i = 0; i < 5; i += 1) {
      arrive[i] = cursor;
      points.push({ x: STATION_X[i], time: cursor, easing: 'linear' });
      cursor += DWELL;
      depart[i] = cursor;
      points.push({ x: STATION_X[i], time: cursor, easing: EASE });
      cursor += i < 4 ? MOVE : EXIT;
    }
    points.push({ x: TO_X, time: cursor, easing: 'linear' });
    const total = cursor;

    const keyframes = points.map((point) => ({
      transform: `translate(${point.x}px,0)`,
      offset: point.time / total,
      easing: point.easing,
    }));

    const animation = train.animate(keyframes, { duration: total * 1000, iterations: Infinity });

    const stationNodes = Array.from(stationsHost.querySelectorAll<SVGGElement>('.lt-st'));
    const labelNodes = Array.from(labelsHost.querySelectorAll<HTMLButtonElement>('.lt-lb'));
    let lastKey = '';

    const applyState = (index: number, stopped: boolean) => {
      const key = `${index}|${stopped}`;
      if (key === lastKey) return;
      lastKey = key;
      stationNodes.forEach((node, i) => node.classList.toggle('lt-on', i === index));
      labelNodes.forEach((label, i) => {
        label.classList.toggle('lt-on', i === index);
        if (i === index) label.setAttribute('aria-current', 'step');
        else label.removeAttribute('aria-current');
      });
      wrap.classList.toggle('lt-stopped', stopped);
    };

    seekRef.current = (index: number) => {
      animation.currentTime = (arrive[index] + 0.3) * 1000;
    };

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      animation.currentTime = (arrive[3] + 0.3) * 1000;
      animation.pause();
    }

    let frame = 0;
    const tick = () => {
      const elapsed = Number(animation.currentTime ?? 0);
      const cycleTime = (elapsed / 1000) % total;
      let index = -1;
      let stopped = false;
      for (let i = 0; i < 5; i += 1) {
        if (cycleTime >= arrive[i] - LEAD && cycleTime < depart[i]) {
          index = i;
          stopped = cycleTime >= arrive[i];
        }
      }
      applyState(index, stopped);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      seekRef.current = null;
      animation.cancel();
    };
  }, []);

  function seek(index: number) {
    seekRef.current?.(index);
  }

  return (
    <div className="lt-figure">
      <div className="lt-panel">
        <h2 className="lt-sr-only">
          Locomotiva com cinco vagões que para por alguns segundos em cada uma das cinco estações,
          acendendo a bolinha e a placa de cada estação
        </h2>
        <div className="lt-wrap" ref={wrapRef}>
          <svg
            viewBox="0 0 800 110"
            role="img"
            aria-label="Trem com locomotiva e cinco vagões parando em cinco estações: Nova solicitação, Em análise, Em andamento, Em observação e Concluído"
          >
            <title>Trem parando em cada uma das cinco estações</title>
            <defs>
              <pattern id="lt-slp" x="0" y="55" width="16" height="20" patternUnits="userSpaceOnUse">
                <rect x="6" y="0" width="3" height="20" fill="#334155" />
              </pattern>
            </defs>

            <rect x="0" y="55" width="800" height="20" fill="url(#lt-slp)" />
            <line x1="0" y1="58" x2="800" y2="58" stroke="#475569" strokeWidth="3.5" />
            <line x1="0" y1="72" x2="800" y2="72" stroke="#475569" strokeWidth="3.5" />

            <g ref={stationsRef}>
              {STATION_X.map((x, i) => (
                <g key={x} className="lt-st" onClick={() => seek(i)}>
                  <line className="lt-post" x1={x} y1="75" x2={x} y2="110" />
                  <circle className="lt-pulse" cx={x} cy="65" r="10" />
                  <circle className="lt-node" cx={x} cy="65" r="7" />
                </g>
              ))}
            </g>

            <g className="lt-train" ref={trainRef}>
              {WAGON_LOADS.map((load, i) => (
                <g key={load} transform={`translate(${-81 - i * 50},0)`}>
                  <g className="lt-rock" style={{ animationDelay: `${(-0.12 * (i + 1)).toFixed(2)}s` }}>
                    <line x1="44" y1="45" x2="50" y2="45" stroke="#475569" strokeWidth="3" />
                    <rect x="0" y="29" width="44" height="19" rx="3" fill="#12213E" stroke="#00AED1" strokeWidth="2" />
                    <rect x="6" y="32" width="32" height="6" rx="1" fill={load} />
                    <rect x="2" y="40" width="40" height="3" fill="#FA7A2F" />
                    <Wheel cx={10} />
                    <Wheel cx={34} />
                  </g>
                </g>
              ))}
              <g className="lt-rock">
                <polygon points="25,38 56,29 56,47" fill="#00AED1" opacity=".12" />
                <rect x="-22" y="29" width="42" height="19" rx="3" fill="#12213E" stroke="#00AED1" strokeWidth="2" />
                <rect x="-31" y="21" width="19" height="27" rx="2" fill="#12213E" stroke="#00AED1" strokeWidth="2" />
                <rect x="-27" y="26" width="9" height="7" rx="1" fill="#FA7A2F" />
                <rect x="6" y="21" width="7" height="9" rx="1" fill="#12213E" stroke="#00AED1" strokeWidth="2" />
                <rect x="-12" y="39" width="32" height="3" fill="#FA7A2F" />
                <circle className="lt-headlight" cx="21" cy="37" r="3.5" fill="#00AED1" />
                {LOCO_WHEELS.map((cx) => (
                  <Wheel key={cx} cx={cx} />
                ))}
              </g>
            </g>
          </svg>

          <div className="lt-labels" ref={labelsRef}>
            {STATION_NAMES.map((name, i) => (
              <button key={name} type="button" className="lt-lb" onClick={() => seek(i)}>
                <span className="lt-nm">{name}</span>
                <span className="lt-ds">{STATION_DESCS[i]}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
