import { useRef } from 'react';
import type { ExerciseId } from '../core/types';
import type { ModelKind } from '../pose/landmarker';
import type { Source } from './Session';

export interface Settings {
  exercise: ExerciseId;
  barbell: boolean;
  voice: boolean;
  heightCm: number;
  model: ModelKind;
}

interface Props {
  settings: Settings;
  onChange(s: Settings): void;
  onStart(source: Source): void;
}

const TIPS: Record<ExerciseId, string> = {
  squat: 'Put your phone at hip height, 2–3 m away, side-on, with your whole body in frame.',
  pushup: 'Put your phone on the floor, 1.5–2 m away, side-on, so your head and feet are both in frame.',
};

export default function Setup({ settings: s, onChange, onStart }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });

  return (
    <main className="setup">
      <header>
        <div className="logo">
          <span className="dot" /> Spotter
        </div>
        <h1>Your form coach, live on your phone.</h1>
        <p className="lede">
          Counts your reps, checks depth and lockout on every one, traces your bar path, and calls out fixes while you lift.
          The video is analyzed on your device and never uploaded.
        </p>
      </header>

      <section className="card">
        <label className="field-label">Exercise</label>
        <div className="seg">
          {(['squat', 'pushup'] as ExerciseId[]).map((e) => (
            <button key={e} className={s.exercise === e ? 'on' : ''} onClick={() => set({ exercise: e })}>
              {e === 'squat' ? 'Squat' : 'Push-up'}
            </button>
          ))}
        </div>
        <p className="tip">{TIPS[s.exercise]}</p>

        <div className="row">
          {s.exercise === 'squat' && (
            <label className="check">
              <input type="checkbox" checked={s.barbell} onChange={(e) => set({ barbell: e.target.checked })} />
              With a barbell (trace the bar)
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={s.voice} onChange={(e) => set({ voice: e.target.checked })} />
            Spoken cues
          </label>
        </div>

        <div className="row">
          <label className="inline">
            Your height
            <input type="number" min={120} max={230} value={s.heightCm} onChange={(e) => set({ heightCm: Number(e.target.value) || 175 })} />
            cm
          </label>
          <label className="inline">
            Model
            <select value={s.model} onChange={(e) => set({ model: e.target.value as ModelKind })}>
              <option value="lite">Lite (fastest)</option>
              <option value="full">Full (more accurate)</option>
            </select>
          </label>
        </div>
      </section>

      <div className="actions">
        <button className="btn primary big" onClick={() => onStart({ kind: 'camera', facing: 'user' })}>Start camera</button>
        <button className="btn ghost big" onClick={() => file.current?.click()}>Analyze a video</button>
        <input
          ref={file}
          type="file"
          accept="video/*"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onStart({ kind: 'file', url: URL.createObjectURL(f), name: f.name });
            e.target.value = '';
          }}
        />
      </div>

      <footer className="foot">
        Pose tracking by MediaPipe, running on your device. Spotter is a training aid, not medical advice.
      </footer>
    </main>
  );
}
