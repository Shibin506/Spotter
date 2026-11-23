import { useRef } from 'react';
import type { ExerciseChoice } from '../core/coach';
import { EXERCISES, EXERCISE_IDS } from '../core/exercises';
import type { ModelKind } from '../pose/landmarker';
import type { Source } from './Session';

export interface Settings {
  exercise: ExerciseChoice;
  barbell: boolean;
  /** Bar weight for barbell lifts, kg (0 = not set). Used for history and the 1-rep-max estimate. */
  weightKg: number;
  voice: boolean;
  /** Listen for "end set", "next set", "mute" and so on. */
  voiceCommands: boolean;
  heightCm: number;
  model: ModelKind;
}

export const DEFAULT_SETTINGS: Settings = {
  exercise: 'auto', barbell: false, weightKg: 0, voice: true, voiceCommands: false, heightCm: 175, model: 'lite',
};

interface Props {
  settings: Settings;
  onChange(s: Settings): void;
  onStart(source: Source): void;
  onHistory(): void;
  voiceSupported: boolean;
  listening: boolean;
}

/** Built for an embedded preview (no camera, no downloads): see `npm run build:embed`. */
export const PREVIEW = import.meta.env.MODE === 'embed';

const SHORT: Record<ExerciseChoice, string> = {
  auto: 'Auto', squat: 'Squat', pushup: 'Push-up', deadlift: 'Deadlift', lunge: 'Lunge', ohp: 'Press', plank: 'Plank',
};

/** Lifts where a bar weight makes sense. */
export const usesBarWeight = (s: Settings) => s.exercise === 'deadlift' || s.exercise === 'ohp' || (s.exercise === 'squat' && s.barbell);

export default function Setup({ settings: s, onChange, onStart, onHistory, voiceSupported, listening }: Props) {
  const file = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const tip = s.exercise === 'auto'
    ? 'Just start lifting: Spotter recognises squats, push-ups, deadlifts, lunges, presses and planks from your first rep.'
    : EXERCISES[s.exercise].tip;

  return (
    <main className="setup">
      <header>
        <div className="top-row">
          <div className="logo"><span className="dot" /> Spotter</div>
          <button className="btn ghost small-btn" onClick={onHistory}>History</button>
        </div>
        <h1>Your form coach, live on your phone.</h1>
        <p className="lede">
          Counts your reps, checks every one, measures bar speed and tells you when to stop, all while you lift.
          The video is analyzed on your device and never uploaded.
        </p>
      </header>

      <section className="card">
        <label className="field-label">Exercise</label>
        <div className="seg seg-grid" data-testid="exercise-picker">
          {(['auto', ...EXERCISE_IDS] as ExerciseChoice[]).map((e) => (
            <button key={e} className={s.exercise === e ? 'on' : ''} onClick={() => set({ exercise: e })}>
              {SHORT[e]}
            </button>
          ))}
        </div>
        <p className="tip">{tip}</p>

        <div className="row">
          {s.exercise === 'squat' && (
            <label className="check">
              <input type="checkbox" checked={s.barbell} onChange={(e) => set({ barbell: e.target.checked })} />
              With a barbell
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={s.voice} onChange={(e) => set({ voice: e.target.checked })} />
            Spoken cues
          </label>
          {voiceSupported && !PREVIEW && (
            <label className="check" title="Say “end set”, “next set”, “mute” or “unmute”">
              <input type="checkbox" checked={s.voiceCommands} onChange={(e) => set({ voiceCommands: e.target.checked })} />
              Voice commands {listening && <span className="live-dot" aria-label="listening" />}
            </label>
          )}
        </div>

        <div className="row">
          {usesBarWeight(s) && (
            <label className="inline">
              Bar weight
              <input type="number" min={0} max={500} step={2.5} value={s.weightKg || ''} placeholder="—"
                     onChange={(e) => set({ weightKg: Number(e.target.value) || 0 })} />
              kg
            </label>
          )}
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
        {s.voiceCommands && (
          <p className="tip">Say <b>“end set”</b> when you finish, <b>“next set”</b> to go again, or <b>“mute”</b> / <b>“unmute”</b>.</p>
        )}
      </section>

      <div className="actions">
        {!PREVIEW && (
          <button className="btn primary big" onClick={() => onStart({ kind: 'camera', facing: 'user' })}>Start camera</button>
        )}
        <button className={`btn big ${PREVIEW ? 'primary' : 'ghost'}`} onClick={() => file.current?.click()}>Analyze a video</button>
        <button
          className="btn ghost big"
          onClick={() => {
            onChange({ ...s, exercise: 'pushup' });
            onStart({ kind: 'file', url: `${import.meta.env.BASE_URL}sample-pushup.webm`, name: 'sample (test mannequin)' });
          }}
        >
          Try a sample video
        </button>
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

      {PREVIEW && (
        <p className="tip">
          This preview can't use your camera. Upload a clip of your lifts, or try the sample (a drawn test mannequin doing
          3 push-ups). The installed app adds live camera coaching.
        </p>
      )}

      <footer className="foot">
        Pose tracking by MediaPipe, running on your device. Spotter is a training aid, not medical advice.
      </footer>
    </main>
  );
}
