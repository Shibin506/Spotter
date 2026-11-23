import { useEffect, useRef, useState } from 'react';
import type { LiveState } from '../core/analyzer';
import { Coach } from '../core/coach';
import { EXERCISES, FAULT_TEXT } from '../core/exercises';
import type { ExerciseId, HoldResult, RepResult, View } from '../core/types';
import { loadLandmarker, resetLandmarker, toFrame, type Landmarker } from '../pose/landmarker';
import { displayAngle, drawOverlay } from './draw';
import { SetRecorder, type Recording } from './recorder';
import type { Settings } from './Setup';
import { Voice } from './speech';

export type Source =
  | { kind: 'camera'; facing: 'user' | 'environment' }
  /** `exercise` overrides the chosen exercise for this video only (the sample is always push-ups). */
  | { kind: 'file'; url: string; name: string; exercise?: ExerciseId };

export interface SetResult {
  exercise: ExerciseId | null;
  reps: RepResult[];
  hold: HoldResult | null;
  view: View;
  cmPerUnit: number | null;
  settings: Settings;
  source: string;
  model: { kind: string; delegate: string };
  perf: { fps: number; inferMs: number };
  recording: Recording | null;
  endedAt: number;
}

export interface SessionCommands {
  end(): void;
  setMuted(m: boolean): void;
}

interface Props {
  settings: Settings;
  source: Source;
  onDone(result: SetResult): void;
  onCancel(): void;
  /** Lets voice commands reach the running session. */
  commands?: React.MutableRefObject<SessionCommands | null>;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

export default function Session({ settings, source, onDone, onCancel, commands }: Props) {
  const videoRef = useRef<VideoWithRvfc>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const initial = (source.kind === 'file' && source.exercise) || settings.exercise;
  const [exercise, setExercise] = useState<ExerciseId | null>(initial === 'auto' ? null : initial);
  const [loading, setLoading] = useState('Loading the pose model…');
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState({ fps: 0, inferMs: 0, delegate: '' });
  const [flash, setFlash] = useState<RepResult | null>(null);
  const [fileProgress, setFileProgress] = useState<number | null>(null);
  const [facing, setFacing] = useState(source.kind === 'camera' ? source.facing : 'environment');
  const [muted, setMuted] = useState(!settings.voice);
  const voice = useRef(new Voice());
  const finishRef = useRef<() => void>(() => {});
  const mirror = source.kind === 'camera' && facing === 'user';

  useEffect(() => {
    voice.current.enabled = !muted;
  }, [muted]);

  useEffect(() => {
    if (!commands) return;
    commands.current = { end: () => finishRef.current(), setMuted };
    return () => {
      commands.current = null;
    };
  }, [commands]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const choice = (source.kind === 'file' && source.exercise) || settings.exercise;
    const coach = new Coach({ exercise: choice, barbell: settings.barbell, heightCm: settings.heightCm });
    let recorder: SetRecorder | null = null;
    let landmarker: Landmarker;
    let lastT = -1;
    let lastPath: { x: number; y: number }[] | null = null;
    const times: number[] = [];
    let inferAvg = 0;
    let lastUi = 0;
    let processed = 0;
    /** Uploaded clips: frame spacing, the last frame's media time, and extra slow-down after skipped frames. */
    const frameMs = 1000 / 30;
    let prevMedia: number | null = null;
    let slowdown = 1;

    const finish = async () => {
      if (stopped) return;
      stopped = true;
      const reps = coach.finish();
      const recording = recorder ? await recorder.stop().catch(() => null) : null;
      onDone({
        exercise: coach.exercise, reps, hold: coach.analyzer?.holdResult ?? null, view: coach.live.view,
        cmPerUnit: coach.live.cmPerUnit, settings, source: source.kind === 'file' ? source.name : 'camera',
        model: { kind: landmarker?.kind ?? settings.model, delegate: landmarker?.delegate ?? '' },
        perf: { fps: fpsOf(times), inferMs: inferAvg }, recording, endedAt: Date.now(),
      });
    };
    finishRef.current = () => void finish();

    /** Runs the pose model and the coach on the video's current frame, at analyzer time `t` (ms). */
    const process = (t: number, adaptRate: boolean) => {
      lastT = t;
      const t0 = performance.now();
      let result;
      try {
        result = landmarker.detect(video, t);
      } catch (e) {
        console.error(e);
        resetLandmarker(landmarker.kind);
        stopped = true;
        setError('The pose model hit an error. Tap Back and start the set again.');
        return;
      }
      const ms = performance.now() - t0;
      inferAvg = inferAvg ? inferAvg * 0.9 + ms * 0.1 : ms;
      processed++;
      if (adaptRate) {
        // Slow the clip down when the model can't keep up, so no frames (or reps) are skipped:
        // from the measured model time, and again whenever frames were actually skipped.
        const gap = prevMedia === null ? 0 : t - prevMedia;
        prevMedia = t;
        if (gap > 2.2 * frameMs) slowdown = Math.max(0.15, slowdown * 0.75);
        if (processed >= 5) {
          const rate = Math.min(1, Math.max(0.05, (frameMs / (inferAvg * 1.3)) * slowdown));
          if (Math.abs(video.playbackRate - rate) > 0.03) video.playbackRate = rate;
        }
      }
      times.push(performance.now());
      if (times.length > 30) times.shift();
      if (canvas.width !== video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      const events = coach.feed(toFrame(result, t, video.videoWidth / video.videoHeight));
      for (const e of events) {
        if (e.type === 'detected') {
          setExercise(e.exercise);
          voice.current.say(EXERCISES[e.exercise].plural, 'count');
        }
        if (e.type === 'cue') voice.current.say(e.text, e.kind === 'fault' ? 'fault' : 'count');
        if (e.type === 'rep') {
          lastPath = e.rep.path;
          setFlash({ ...e.rep });
        }
        if (e.type === 'rep-updated') setFlash((f) => (f && f.index === e.rep.index ? { ...e.rep } : f));
      }
      const state = coach.live;
      drawOverlay(ctx, state, { exercise: coach.exercise, mirror, lastPath });
      if (!recorder && SetRecorder.supported()) {
        try {
          recorder = new SetRecorder(video.videoWidth, video.videoHeight);
          recorder.start();
        } catch {
          recorder = null;
        }
      }
      recorder?.draw(video, canvas, mirror, state, t, coach.exercise ? (state.hold ? 'plank' : EXERCISES[coach.exercise].plural) : 'reps');
      if (performance.now() - lastUi > 80 || events.length) {
        lastUi = performance.now();
        setLive({ ...state, reps: [...state.reps] });
        setPerf({ fps: fpsOf(times), inferMs: inferAvg, delegate: landmarker.delegate });
      }
    };

    const frame = (now: number, mediaTime?: number) => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        // MediaPipe needs strictly increasing timestamps. Files use the video's own clock, so tempo and
        // bar speed stay right even when processing is slower than real time.
        const t = Math.max(lastT + 1, Math.round(source.kind === 'file' ? (mediaTime ?? video.currentTime) * 1000 : now));
        if (t !== lastT) process(t, source.kind === 'file');
      }
      schedule();
    };

    /** Uploaded clips: visit every frame in turn (seek, analyze), so nothing is skipped however slow the device. */
    const stepThrough = async () => {
      const n = Math.floor(video.duration * 30);
      for (let i = 0; i < n && !stopped; i++) {
        await seekTo(video, i / 30);
        if (stopped) return;
        process(Math.round(i * frameMs) + 1, false);
        if (i % 15 === 0) setFileProgress(i / n);
      }
      if (!stopped) void finish();
    };
    const schedule = () => {
      if (stopped) return;
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback((now, meta) => frame(now, meta.mediaTime));
      else requestAnimationFrame((now) => frame(now));
    };

    (async () => {
      try {
        landmarker = await loadLandmarker(settings.model);
        if (stopped) return;
        if (source.kind === 'camera') {
          setLoading('Starting the camera…');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
          });
          if (stopped) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          video.srcObject = stream;
        } else {
          video.src = source.url;
          await new Promise<void>((resolve, reject) => {
            video.onloadeddata = () => resolve();
            video.onerror = () => reject(new Error('This video could not be opened.'));
          });
          if (stopped) return;
          if (Number.isFinite(video.duration) && video.duration > 0) {
            // iOS Safari only decodes frames of a video that has played: play a moment, then step through.
            await video.play().catch(() => undefined);
            video.pause();
            setLoading('');
            await stepThrough();
            return;
          }
          // No usable duration (some recorded WebM files): play it, slowing down when the model falls behind.
          video.onended = () => void finish();
          video.playbackRate = 0.25;
        }
        await video.play();
        if (stopped) return;
        setLoading('');
        schedule();
      } catch (e) {
        setError(friendlyError(e));
      }
    })();

    return () => {
      stopped = true;
      void recorder?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      video.pause();
    };
    // Restart the whole pipeline when the camera is flipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const hold = live?.hold;
  const config = exercise ? EXERCISES[exercise] : null;
  const last = live?.reps[live.reps.length - 1];

  return (
    <div className="session">
      <div className={`stage ${mirror ? 'mirror' : ''}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      <div className="hud-top">
        <div>
          <div className="count" data-testid="rep-count">
            <span className="count-n">{config?.mode === 'hold' ? `${Math.floor(hold?.goodSec ?? 0)}s` : live?.reps.length ?? 0}</span>
            <span className="count-l">{config ? (config.mode === 'hold' ? 'good form' : config.plural) : 'reps'}</span>
          </div>
          {last?.velocity != null && config?.mode === 'reps' && (
            <div className="speed" data-testid="speed">
              {last.velocity.toFixed(2)} m/s
              {last.velocityLoss != null && last.index > 1 && <span className={last.velocityLoss >= 0.2 ? 'bad' : ''}> · −{Math.round(last.velocityLoss * 100)}%</span>}
            </div>
          )}
          {config?.mode === 'hold' && hold && <div className="speed">{hold.totalSec.toFixed(0)} s total</div>}
        </div>
        <div className="meter">
          <div className="phase">
            {initial === 'auto' && <span className="chip-auto" data-testid="detected">{config ? `Auto · ${config.name}` : 'Auto'}</span>}
            {live?.status === 'tracking' ? (config?.mode === 'hold' ? (live.holdFault ? FAULT_TEXT[live.holdFault].label : 'holding') : live.phase) : '—'}
            {live?.view === 'front' && ' · front view'}
          </div>
          <div className="angle">{live?.angle != null ? `${Math.round(displayAngle(exercise, live.angle))}°` : '—'}</div>
          <div className="perf" data-testid="perf">
            {fileProgress !== null && `analyzing ${Math.round(fileProgress * 100)}% · `}
            {perf.fps ? `${perf.fps.toFixed(0)} fps · ${perf.inferMs.toFixed(0)} ms · ${perf.delegate}` : ''}
          </div>
        </div>
      </div>

      {(loading || error || live?.guidance) && (
        <div className={`banner ${error ? 'error' : ''}`} data-testid="banner">
          {error ?? (loading || live?.guidance)}
        </div>
      )}

      {flash && (
        <div key={`${flash.index}-${flash.faults.length}`} className={`rep-flash ${flash.faults.length ? 'bad' : 'good'}`}>
          <b>Rep {flash.index}</b>
          {flash.faults.length ? flash.faults.map((f) => <span key={f}>{FAULT_TEXT[f].label}</span>) : <span>Good rep</span>}
          <span className="muted">
            ↓ {flash.downSec.toFixed(1)}s · ↑ {flash.upSec.toFixed(1)}s{flash.velocity != null && ` · ${flash.velocity.toFixed(2)} m/s`}
          </span>
        </div>
      )}

      <div className="controls">
        <button className="btn ghost" onClick={onCancel}>Back</button>
        {source.kind === 'camera' && (
          <button className="btn ghost" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>Flip camera</button>
        )}
        <button className="btn ghost" onClick={() => { voice.current.unlock(); setMuted((m) => !m); }}>{muted ? 'Voice off' : 'Voice on'}</button>
        <button className="btn primary" onClick={() => finishRef.current()} data-testid="end-set">End set</button>
      </div>
    </div>
  );
}

/** Seeks and waits for the frame; gives up waiting after 2 s so a missing 'seeked' event can't stall the set. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', done);
      resolve();
    };
    const timer = setTimeout(done, 2000);
    video.addEventListener('seeked', done);
    video.currentTime = t;
  });
}

function friendlyError(e: unknown): string {
  const name = e instanceof Error ? e.name : '';
  if (name === 'NotAllowedError') return 'Camera access was blocked. Allow the camera for this site, or go back and analyze a video instead.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No camera was found. Go back and analyze a video instead.';
  if (name === 'NotReadableError') return 'The camera is in use by another app. Close it and try again.';
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function fpsOf(times: number[]): number {
  if (times.length < 2) return 0;
  return ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
}
