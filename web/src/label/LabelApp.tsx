// Labelling page: analyze a clip, correct what Spotter got wrong, and export labels for the eval and
// for training the form model. Everything stays in the browser.

import { useEffect, useRef, useState } from 'react';
import { EXERCISES, EXERCISE_IDS, FAULT_TEXT } from '../core/exercises';
import type { ExerciseId, FaultId, RepResult } from '../core/types';
import { LABELS_FORMAT, reportMarkdown, scoreClip, summarizeClips, type ClipResult, type Labels, type TruthRep } from '../eval/metrics';
import { analyzeVideo, packFrames, type OfflineResult } from '../pose/offline';
import type { ModelKind } from '../pose/landmarker';

interface Row {
  key: string;
  /** Bottom of the rep, seconds. */
  t: number;
  real: boolean;
  faults: FaultId[];
  detected: RepResult | null;
}

export default function LabelApp() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [exercise, setExercise] = useState<ExerciseId>('squat');
  const [model, setModel] = useState<ModelKind>('full');
  const [heightCm, setHeightCm] = useState(175);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<OfflineResult | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    setResult(null);
    setRows([]);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // Hook for scripts/run-eval.mjs: analyze the loaded clip and score it against labels.
  useEffect(() => {
    (window as unknown as { __spotterEval: unknown }).__spotterEval = async (labels: Labels) => {
      if (!url) throw new Error('no video loaded');
      const r = await analyzeVideo(url, labels.exercise, { model, heightCm: labels.heightCm ?? 175, barbell: labels.barbell });
      return scoreClip(labels.video.name, labels.exercise, labels.truth.reps, r.reps, r.inferMs);
    };
    (window as unknown as { __spotterReport: unknown }).__spotterReport = (clips: ClipResult[], note: string) => {
      const report = summarizeClips(clips);
      return { report, markdown: reportMarkdown(report, clips, note) };
    };
  }, [url, model]);

  const analyze = async () => {
    if (!url) return;
    setError(null);
    setProgress(0);
    try {
      const r = await analyzeVideo(url, exercise, { model, heightCm }, setProgress);
      setResult(r);
      setRows(r.reps.map((d, i) => ({ key: `d${i}`, t: d.tBottom / 1000, real: true, faults: [...d.faults], detected: d })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const loadLabels = async (f: File) => {
    try {
      const l = JSON.parse(await f.text()) as Labels;
      if (l.format !== LABELS_FORMAT) throw new Error('not a Spotter labels file');
      setExercise(l.exercise);
      if (l.heightCm) setHeightCm(l.heightCm);
      setRows(l.truth.reps.map((r, i) => ({ key: `l${i}`, t: r.t, real: true, faults: [...r.faults], detected: null })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleFault = (key: string, f: FaultId) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, faults: r.faults.includes(f) ? r.faults.filter((x) => x !== f) : [...r.faults, f] } : r)));
  const addMissed = () => {
    const t = video.current?.currentTime ?? 0;
    setRows((rs) => [...rs, { key: `m${Date.now()}`, t, real: true, faults: [], detected: null }].sort((a, b) => a.t - b.t));
  };
  const seekTo = (t: number) => {
    if (video.current) video.current.currentTime = Math.max(0, t);
  };

  const exportLabels = () => {
    if (!file) return;
    const truth: TruthRep[] = rows.filter((r) => r.real).map((r) => ({ t: Math.round(r.t * 1000) / 1000, faults: r.faults }));
    const labels: Labels = {
      format: LABELS_FORMAT,
      video: { name: file.name, durationSec: result?.durationSec ?? video.current?.duration ?? 0 },
      exercise, heightCm, truth: { reps: truth },
      frames: result ? packFrames(result.frames) : undefined,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(labels)], { type: 'application/json' }));
    a.download = `${file.name.replace(/\.[^.]+$/, '')}.labels.json`;
    a.click();
  };

  const faultIds = EXERCISES[exercise].faultIds;

  return (
    <main className="label-app">
      <div className="top-row">
        <div className="logo"><span className="dot" /> Spotter</div>
        <a className="btn ghost small-btn" href="./">Back to the app</a>
      </div>
      <h1>Label clips</h1>
      <p className="muted">
        Load a side-on clip, let Spotter analyze it frame by frame, then fix anything it got wrong: untick reps that
        weren't real, add reps it missed, and set the right form flags. Export the labels for the accuracy eval and for
        training the form model. The video never leaves your browser.
      </p>

      <section className="card">
        <div className="row">
          <label className="inline">Video <input type="file" accept="video/*" id="video-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
          <label className="inline">Labels <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && loadLabels(e.target.files[0])} /></label>
        </div>
        <div className="row">
          <label className="inline">Exercise
            <select value={exercise} onChange={(e) => setExercise(e.target.value as ExerciseId)}>
              {EXERCISE_IDS.map((x) => <option key={x} value={x}>{EXERCISES[x].name}</option>)}
            </select>
          </label>
          <label className="inline">Height <input type="number" value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value) || 175)} /> cm</label>
          <label className="inline">Model
            <select value={model} onChange={(e) => setModel(e.target.value as ModelKind)}>
              <option value="full">Full</option>
              <option value="lite">Lite</option>
            </select>
          </label>
          <button className="btn primary" disabled={!url || progress !== null} onClick={analyze} data-testid="analyze">
            {progress !== null ? `Analyzing… ${Math.round(progress * 100)}%` : 'Analyze'}
          </button>
        </div>
        {progress !== null && <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>}
        {error && <p className="error-text">{error}</p>}
      </section>

      {url && (
        <div className="label-grid">
          <div>
            <video ref={video} className="label-video" src={url} controls playsInline muted />
            <div className="row">
              <button className="btn ghost small-btn" onClick={addMissed}>+ Missed rep at the current time</button>
              <button className="btn primary small-btn" onClick={exportLabels} disabled={!rows.length} data-testid="export">Export labels</button>
            </div>
            {result && (
              <p className="muted small">
                {result.reps.length} reps detected · {result.frames.filter((f) => f.landmarks).length}/{result.frames.length} frames with a person ·{' '}
                {(result.inferMs.reduce((a, b) => a + b, 0) / Math.max(1, result.inferMs.length)).toFixed(0)} ms/frame on {result.delegate}
              </p>
            )}
          </div>
          <div className="reps-list" data-testid="reps">
            {rows.map((r, i) => (
              <div key={r.key} className={`rep-row ${r.real ? '' : 'off'}`}>
                <div className="head">
                  <button className="btn ghost small-btn" onClick={() => seekTo((r.detected ? r.detected.tStart / 1000 : r.t) - 0.3)}>
                    #{i + 1} · {r.t.toFixed(2)} s {r.detected ? '' : '(added)'}
                  </button>
                  <label className="check">
                    <input type="checkbox" checked={r.real} onChange={(e) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, real: e.target.checked } : x)))} />
                    Real rep
                  </label>
                </div>
                <div className="fault-chips">
                  {faultIds.map((f) => (
                    <button key={f} className={r.faults.includes(f) ? 'on' : ''} onClick={() => toggleFault(r.key, f)}>{FAULT_TEXT[f].label}</button>
                  ))}
                </div>
              </div>
            ))}
            {!rows.length && <p className="muted">Analyze the clip to list its reps.</p>}
          </div>
        </div>
      )}
    </main>
  );
}
