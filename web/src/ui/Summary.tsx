import { FAULT_TEXT } from '../core/exercises';
import { summarize } from '../core/insights';
import type { SetResult } from './Session';

interface Props {
  result: SetResult;
  onAgain(): void;
  onHome(): void;
}

export default function Summary({ result, onAgain, onHome }: Props) {
  const { reps, cmPerUnit, settings } = result;
  const sum = summarize(reps, settings.exercise, cmPerUnit, settings.barbell);
  const cm = (u: number | null) => (u === null || !cmPerUnit ? '—' : `${u >= 0 ? '+' : ''}${Math.round(u * cmPerUnit)} cm`);

  const download = () => {
    const blob = new Blob([JSON.stringify({ ...result, reps: reps.map(({ path, ...r }) => ({ ...r, pathPoints: path.length })) }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `spotter-${settings.exercise}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
  };

  return (
    <main className="summary">
      <h2>
        {sum.reps} {settings.exercise === 'squat' ? 'squats' : 'push-ups'}
        <span className="muted"> · {sum.clean} clean</span>
      </h2>
      <ul className="notes" data-testid="notes">
        {sum.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>

      {reps.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rep</th>
                <th>{settings.exercise === 'squat' ? 'Knee' : 'Elbow'} min</th>
                {settings.exercise === 'squat' && <th>Hip vs knee</th>}
                <th>Down</th>
                <th>Up</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => (
                <tr key={r.index} className={r.faults.length ? 'bad' : ''}>
                  <td>{r.index}</td>
                  <td>{Math.round(r.minAngle)}°</td>
                  {settings.exercise === 'squat' && <td>{cm(r.depthUnits)}</td>}
                  <td>{r.downSec.toFixed(1)} s</td>
                  <td>{r.upSec.toFixed(1)} s</td>
                  <td>{r.faults.length ? r.faults.map((f) => FAULT_TEXT[f].label).join(', ') : '✓'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {settings.exercise === 'squat' && 'Centimetres are estimates from your height and leg proportions. '}Model: {result.model.kind} on {result.model.delegate || '—'},
        {' '}{result.perf.fps.toFixed(0)} fps, {result.perf.inferMs.toFixed(0)} ms per frame.
      </p>

      <div className="actions">
        <button className="btn primary big" onClick={onAgain}>Next set</button>
        <button className="btn ghost big" onClick={download}>Download data</button>
        <button className="btn ghost big" onClick={onHome}>Home</button>
      </div>
    </main>
  );
}
