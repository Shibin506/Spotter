import { useMemo, useState } from 'react';
import { EXERCISES, EXERCISE_IDS, FAULT_TEXT } from '../core/exercises';
import { bests, dailyCounts, type History, type SavedSet } from '../core/history';
import type { ExerciseId, FaultId } from '../core/types';

interface Props {
  history: History;
  onBack(): void;
}

export default function HistoryView({ history, onBack }: Props) {
  const [sets, setSets] = useState<SavedSet[]>(() => history.all());
  const used = EXERCISE_IDS.filter((e) => sets.some((s) => s.exercise === e));
  const [ex, setEx] = useState<ExerciseId | null>(used[0] ?? null);
  const days = useMemo(() => dailyCounts(sets, 14), [sets]);
  const b = ex ? bests(sets, ex) : null;
  const recent = [...sets].reverse().slice(0, 30);
  const maxDay = Math.max(1, ...days.map((d) => d.sets));
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <main className="summary history" data-testid="history">
      <div className="top-row">
        <h2>History</h2>
        <button className="btn ghost small-btn" onClick={onBack}>Back</button>
      </div>
      {sets.length === 0 && <p className="muted">No sets yet. Finish a set and it shows up here; it stays on this device.</p>}

      {sets.length > 0 && (
        <>
          <section className="card">
            <h3>Last 14 days</h3>
            <div className="days" aria-label="Sets per day">
              {days.map((d, i) => (
                <div key={i} className="day" title={`${d.sets} sets, ${d.reps} reps`}>
                  <div className="bar" style={{ height: `${(d.sets / maxDay) * 100}%` }} />
                  <span>{d.day}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="seg seg-grid">
              {used.map((e) => (
                <button key={e} className={ex === e ? 'on' : ''} onClick={() => setEx(e)}>{EXERCISES[e].name}</button>
              ))}
            </div>
            {b && ex && (
              <div className="bests" data-testid="bests">
                {b.mostReps && <Best label="Most reps in a set" value={`${b.mostReps.reps}`} when={b.mostReps.at} />}
                {b.heaviest && <Best label="Heaviest set" value={`${b.heaviest.weightKg} kg × ${b.heaviest.reps}`} when={b.heaviest.at} />}
                {b.fastest && <Best label="Fastest rep" value={`${b.fastest.velocity.toFixed(2)} m/s`} when={b.fastest.set.at} />}
                {b.longestHold && <Best label="Longest good hold" value={`${Math.round(b.longestHold.hold!.goodSec)} s`} when={b.longestHold.at} />}
                {EXERCISES[ex].minVelocity !== null && (
                  <Best
                    label="Estimated 1-rep max"
                    value={b.e1rm ? `${b.e1rm} kg` : '—'}
                    note={b.e1rm ? 'From your bar speed at different weights.' : 'Log sets at two or more weights (10 kg apart) with your bar weight set.'}
                  />
                )}
              </div>
            )}
          </section>

          <section className="card">
            <h3>Recent sets</h3>
            <ul className="recent">
              {recent.map((s) => (
                <li key={s.id}>
                  <span>{new Date(s.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  <b>{EXERCISES[s.exercise].name}</b>
                  <span>
                    {s.hold ? `${Math.round(s.hold.goodSec)} s hold` : `${s.reps} reps · ${s.clean} clean`}
                    {s.weightKg ? ` · ${s.weightKg} kg` : ''}
                    {s.velocities.length ? ` · best ${Math.max(...s.velocities).toFixed(2)} m/s` : ''}
                  </span>
                  <span className="muted">{(Object.entries(s.faults) as [FaultId, number][]).map(([f, n]) => `${FAULT_TEXT[f].label} ×${n}`).join(', ')}</span>
                </li>
              ))}
            </ul>
            <button
              className="btn ghost small-btn"
              onClick={() => {
                if (!confirmClear) return setConfirmClear(true);
                history.clear();
                setSets([]);
              }}
            >
              {confirmClear ? 'Tap again to delete all history on this device' : 'Clear history'}
            </button>
          </section>
        </>
      )}
    </main>
  );
}

function Best({ label, value, when, note }: { label: string; value: string; when?: number; note?: string }) {
  return (
    <div className="best">
      <span className="muted small">{label}</span>
      <b>{value}</b>
      {when && <span className="muted small">{new Date(when).toLocaleDateString()}</span>}
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}
