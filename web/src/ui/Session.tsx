import { useEffect, useRef, useState } from 'react';
import { Analyzer, type LiveState } from '../core/analyzer';
import { FAULT_TEXT } from '../core/exercises';
import type { RepResult } from '../core/types';
import { loadLandmarker, toFrame, type Landmarker } from '../pose/landmarker';
import { drawOverlay } from './draw';
import type { Settings } from './Setup';
import { Voice } from './speech';

export type Source = { kind: 'camera'; facing: 'user' | 'environment' } | { kind: 'file'; url: string; name: string };

export interface SetResult {
  reps: RepResult[];
  cmPerUnit: number | null;
  settings: Settings;
  source: string;
  model: { kind: string; delegate: string };
  perf: { fps: number; inferMs: number };
}

interface Props {
  settings: Settings;
  source: Source;
  onDone(result: SetResult): void;
  onCancel(): void;
}

type VideoWithRvfc = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

export default function Session({ settings, source, onDone, onCancel }: Props) {
  const videoRef = useRef<VideoWithRvfc>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [live, setLive] = useState<LiveState | null>(null);
  const [loading, setLoading] = useState('Loading the pose model…');
  const [error, setError] = useState<string | null>(null);
  const [perf, setPerf] = useState({ fps: 0, inferMs: 0, delegate: '' });
  const [flash, setFlash] = useState<RepResult | null>(null);
  const [facing, setFacing] = useState(source.kind === 'camera' ? source.facing : 'environment');
  const [muted, setMuted] = useState(!settings.voice);
  const voice = useRef(new Voice());
  const finishRef = useRef<() => void>(() => {});
  const mirror = source.kind === 'camera' && facing === 'user';

  useEffect(() => {
    voice.current.enabled = !muted;
  }, [muted]);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    const video = videoRef.current!;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const analyzer = new Analyzer({ exercise: settings.exercise, barbell: settings.barbell, heightCm: settings.heightCm });
    let landmarker: Landmarker;
    let lastT = -1;
    let lastPath: { x: number; y: number }[] | null = null;
    const times: number[] = [];
    let inferAvg = 0;
    let lastUi = 0;
    let processed = 0;

    const finish = () => {
      if (stopped) return;
      stopped = true;
      const reps = analyzer.finish();
      onDone({
        reps, cmPerUnit: analyzer.live.cmPerUnit, settings,
        source: source.kind === 'file' ? source.name : 'camera',
        model: { kind: landmarker?.kind ?? settings.model, delegate: landmarker?.delegate ?? '' },
        perf: { fps: fpsOf(times), inferMs: inferAvg },
      });
    };
    finishRef.current = finish;

    const frame = (now: number, mediaTime?: number) => {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth > 0) {
        // MediaPipe needs strictly increasing timestamps. Files use the video's own clock, so tempo
        // stays right even when processing is slower than real time.
        const t = Math.max(lastT + 1, Math.round(source.kind === 'file' ? (mediaTime ?? video.currentTime) * 1000 : now));
        if (t !== lastT) {
          lastT = t;
          const t0 = performance.now();
          const result = landmarker.detect(video, t);
          const ms = performance.now() - t0;
          inferAvg = inferAvg ? inferAvg * 0.9 + ms * 0.1 : ms;
          processed++;
          if (source.kind === 'file' && processed >= 5) {
            // Slow the clip down when the model can't keep up, so no frames (or reps) are skipped.
            // Tempo stays right because timestamps come from the video's own clock.
            const rate = Math.min(1, Math.max(0.1, 1000 / 30 / (inferAvg * 1.3)));
            if (Math.abs(video.playbackRate - rate) > 0.05) video.playbackRate = rate;
          }
          times.push(performance.now());
          if (times.length > 30) times.shift();
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const events = analyzer.feed(toFrame(result, t, video.videoWidth / video.videoHeight));
          for (const e of events) {
            if (e.type === 'cue') voice.current.say(e.text, e.kind);
            if (e.type === 'rep') {
              lastPath = e.rep.path;
              setFlash({ ...e.rep });
            }
            if (e.type === 'rep-updated') setFlash((f) => (f && f.index === e.rep.index ? { ...e.rep } : f));
          }
          drawOverlay(ctx, analyzer.live, { exercise: settings.exercise, mirror, lastPath });
          if (performance.now() - lastUi > 80 || events.length) {
            lastUi = performance.now();
            setLive({ ...analyzer.live, reps: [...analyzer.live.reps] });
            setPerf({ fps: fpsOf(times), inferMs: inferAvg, delegate: landmarker.delegate });
          }
        }
      }
      schedule();
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
          video.onended = finish;
          // Start slow while the model warms up and its speed is measured; it speeds up after a few frames.
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
      stream?.getTracks().forEach((t) => t.stop());
      video.pause();
    };
    // Restart the whole pipeline when the camera is flipped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  const reps = live?.reps.length ?? 0;
  const angle = live?.angle;

  return (
    <div className="session">
      <div className={`stage ${mirror ? 'mirror' : ''}`}>
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
      </div>

      <div className="hud-top">
        <div className="count" data-testid="rep-count">
          <span className="count-n">{reps}</span>
          <span className="count-l">reps</span>
        </div>
        <div className="meter">
          <div className="phase">{live?.status === 'tracking' ? live.phase : '—'}</div>
          <div className="angle">{angle != null ? `${Math.round(angle)}°` : '—'}</div>
          <div className="perf" data-testid="perf">
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
          <span className="muted">↓ {flash.downSec.toFixed(1)}s · ↑ {flash.upSec.toFixed(1)}s</span>
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
