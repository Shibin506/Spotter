import { useEffect, useMemo, useState } from 'react';
import { EXERCISES, FAULT_TEXT } from '../core/exercises';
import { summarize } from '../core/insights';
import { buildHighlight, type Highlight } from './highlight';
import type { SetResult } from './Session';
import { PREVIEW } from './Setup';

interface Props {
  result: SetResult;
  onAgain(): void;
  onHome(): void;
  onHistory(): void;
}

type CoachState = { status: 'idle' } | { status: 'loading' } | { status: 'done'; text: string } | { status: 'error'; text: string };

export default function Summary({ result, onAgain, onHome, onHistory }: Props) {
  const { reps, cmPerUnit, settings, exercise, hold } = result;
  const config = exercise ? EXERCISES[exercise] : null;
  const sum = useMemo(() => (exercise ? summarize(reps, exercise, cmPerUnit, settings.barbell, hold) : null), [reps, exercise, cmPerUnit, settings.barbell, hold]);
  const [clip, setClip] = useState<Highlight | null>(null);
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const [making, setMaking] = useState<number | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [coach, setCoach] = useState<CoachState>({ status: 'idle' });
  const cm = (u: number | null) => (u === null || !cmPerUnit ? '—' : `${u >= 0 ? '+' : ''}${Math.round(u * cmPerUnit)} cm`);
  const hasVelocity = reps.some((r) => r.velocity !== null);

  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  const makeClip = async () => {
    if (!result.recording) return;
    setClipError(null);
    setMaking(0);
    try {
      const h = await buildHighlight({ recording: result.recording, exercise, reps, worst: sum?.worst ?? null, hold, cmPerUnit }, setMaking);
      setClip(h);
      setClipUrl(URL.createObjectURL(h.blob));
    } catch (e) {
      setClipError(e instanceof Error ? e.message : String(e));
    } finally {
      setMaking(null);
    }
  };

  const share = async () => {
    if (!clip) return;
    const file = new File([clip.blob], clip.fileName, { type: clip.mime });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'My set, coached by Spotter' });
        return;
      } catch {
        /* cancelled: fall through to download */
      }
    }
    const a = document.createElement('a');
    a.href = clipUrl!;
    a.download = clip.fileName;
    a.click();
  };

  const askCoach = async () => {
    if (!exercise) return;
    setCoach({ status: 'loading' });
    try {
      const res = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coachPayload(result)),
      });
      const data = (await res.json().catch(() => ({}))) as { note?: string; error?: string };
      if (!res.ok || !data.note) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCoach({ status: 'done', text: data.note });
    } catch (e) {
      setCoach({ status: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...result, recording: undefined, reps: reps.map(({ path, ...r }) => ({ ...r, pathPoints: path.length })) }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spotter-${exercise ?? 'set'}-${new Date(result.endedAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
  };

  return (
    <main className="summary">
      <h2>
        {config?.mode === 'hold' && hold ? `${Math.round(hold.goodSec)} s plank` : `${reps.length} ${config?.plural ?? 'reps'}`}
        {config?.mode === 'reps' && <span className="muted"> · {sum?.clean ?? 0} clean</span>}
      </h2>
      <ul className="notes" data-testid="notes">
        {(sum?.notes ?? ['No exercise was recognised. Try again with your whole body in frame, or pick the exercise.']).map((n) => <li key={n}>{n}</li>)}
      </ul>

      {hasVelocity && <SpeedChart reps={reps} bar={settings.barbell || exercise === 'deadlift' || exercise === 'ohp'} />}

      {reps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>Angle</th>
                {(exercise === 'squat' || exercise === 'lunge') && <th>Hip vs knee</th>}
                <th className="hide-sm">Down</th>
                <th>Up</th>
                {hasVelocity && <th>Speed</th>}
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.index} className={r.faults.length ? 'bad' : ''}>
                  <td>{r.index}</td>
                  <td>{Math.round(exercise === 'ohp' ? 180 - r.minAngle : r.minAngle)}°</td>
                  {(exercise === 'squat' || exercise === 'lunge') && <td>{cm(r.depthUnits)}</td>}
                  <td className="hide-sm">{r.downSec.toFixed(1)} s</td>
                  <td>{r.upSec.toFixed(1)} s</td>
                  {hasVelocity && <td>{r.velocity !== null ? `${r.velocity.toFixed(2)} m/s` : '—'}</td>}
                  <td>{r.faults.length ? r.faults.map((f) => FAULT_TEXT[f].label).join(', ') : '✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card share" data-testid="share">
        <h3>Share your set</h3>
        {!result.recording && <p className="muted small">This browser can't record video, so a clip isn't available.</p>}
        {result.recording && !clip && (
          <>
            <p className="muted small">A short clip with your reps, a slow-motion replay of the rep worth a second look, and your stats.</p>
            <button className="btn primary" onClick={makeClip} disabled={making !== null} data-testid="make-clip">
              {making !== null ? `Making your clip… ${Math.round(making * 100)}%` : 'Make highlight clip'}
            </button>
          </>
        )}
        {clipError && <p className="error-text">{clipError}</p>}
        {clip && clipUrl && (
          <>
            <video className="clip" src={clipUrl} controls playsInline loop autoPlay muted data-testid="clip" />
            {!PREVIEW && <button className="btn primary" onClick={share}>Share or save clip</button>}
          </>
        )}
      </section>

      {!PREVIEW && exercise && (
        <section className="card" data-testid="ai-coach">
          <h3>AI coach note</h3>
          <p className="muted small">Sends only the numbers above (never video) to an AI model for a short coaching tip.</p>
          {coach.status === 'idle' && <button className="btn ghost" onClick={askCoach}>Get a coaching tip</button>}
          {coach.status === 'loading' && <p className="muted">Thinking…</p>}
          {coach.status === 'done' && <div className="coach-note">{coach.text.split('\n').filter(Boolean).map((l) => <p key={l}>{l}</p>)}</div>}
          {coach.status === 'error' && <p className="error-text">The coach isn't available right now ({coach.text}).</p>}
        </section>
      )}

      <p className="muted small">
        {(exercise === 'squat' || exercise === 'lunge' || hasVelocity) && 'Centimetres and m/s are estimates from your height and leg proportions. '}
        Model: {result.model.kind} on {result.model.delegate || '—'}, {result.perf.fps.toFixed(0)} fps, {result.perf.inferMs.toFixed(0)} ms per frame.
      </p>

      <div className="actions">
        <button className="btn primary big" onClick={onAgain}>Next set</button>
        <button className="btn ghost big" onClick={onHistory}>History</button>
        {!PREVIEW && <button className="btn ghost big" onClick={download}>Download data</button>}
        <button className="btn ghost big" onClick={onHome}>Home</button>
      </div>
    </main>
  );
}

/** Bar speed per rep, with the 20% drop-off line. */
function SpeedChart({ reps, bar }: { reps: SetResult['reps']; bar: boolean }) {
  const v = reps.map((r) => r.velocity ?? 0);
  const max = Math.max(...v, 0.1);
  const best = Math.max(...v.slice(0, 3));
  const W = 560, H = 140, pad = 26, bw = Math.min(48, (W - pad * 2) / v.length - 8);
  const y = (val: number) => H - pad - (val / max) * (H - pad * 2);
  return (
    <figure className="speed-chart" data-testid="speed-chart">
      <figcaption className="muted small">
        {bar ? 'Bar speed' : 'Rep speed'} per rep (m/s, lifting half of each rep). The dashed line is a 20% drop from your fastest early rep.
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar speed per rep">
        <line x1={pad} x2={W - pad} y1={y(best * 0.8)} y2={y(best * 0.8)} stroke="#fb7185" strokeDasharray="6 6" strokeWidth="1.5" />
        {v.map((val, i) => {
          const x = pad + i * ((W - pad * 2) / v.length) + 4;
          const low = val < best * 0.8;
          return (
            <g key={i}>
              <rect x={x} y={y(val)} width={bw} height={Math.max(0, H - pad - y(val))} rx="4" fill={low ? '#fb7185' : '#c6f432'} />
              <text x={x + bw / 2} y={y(val) - 6} textAnchor="middle" fontSize="15" fill="#e5e8eb">{val ? val.toFixed(2) : '—'}</text>
              <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="15" fill="#9aa3ad">{i + 1}</text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Only numbers go to the coach endpoint: no video, no landmarks, no personal details. */
export function coachPayload(r: SetResult) {
  return {
    exercise: r.exercise,
    view: r.view,
    weightKg: r.settings.weightKg || null,
    hold: r.hold,
    reps: r.reps.map((x) => ({
      index: x.index, downSec: round(x.downSec), upSec: round(x.upSec), minAngle: Math.round(x.minAngle),
      hipBelowKneeCm: x.depthUnits !== null && r.cmPerUnit ? Math.round(x.depthUnits * r.cmPerUnit) : null,
      velocity: x.velocity !== null ? round(x.velocity) : null, velocityLoss: x.velocityLoss !== null ? round(x.velocityLoss) : null,
      maxLean: Math.round(x.maxLean), faults: x.faults,
    })),
  };
}

const round = (v: number) => Math.round(v * 100) / 100;
