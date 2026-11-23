// Dev helper: renders a synthetic set as mannequin frames (exposed on window for a script to save).
import { drawMannequin, skeletonFor } from './mannequin';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** Angles over time for a set: standing, then cosine-eased reps. */
function plan(exercise: 'squat' | 'pushup', bottoms: number[], fps: number): number[] {
  const top = exercise === 'squat' ? 176 : 172;
  const out: number[] = [];
  const hold = (a: number, sec: number) => { for (let i = 0; i < sec * fps; i++) out.push(a); };
  const move = (a: number, b: number, sec: number) => {
    const n = Math.round(sec * fps);
    for (let i = 0; i < n; i++) out.push(a + (b - a) * (1 - Math.cos((Math.PI * i) / n)) / 2);
  };
  hold(top, 1);
  for (const b of bottoms) { move(top, b, 1.1); move(b, top, 0.9); hold(top, 0.5); }
  hold(top, 1);
  return out;
}

Object.assign(window, {
  renderSet(exercise: 'squat' | 'pushup', bottoms: number[], fps = 30): number {
    const angles = plan(exercise, bottoms, fps);
    (window as unknown as { frames: number[] }).frames = angles;
    return angles.length;
  },
  frameAt(i: number, exercise: 'squat' | 'pushup'): string {
    const a = (window as unknown as { frames: number[] }).frames[i];
    drawMannequin(ctx, skeletonFor(exercise, a), exercise);
    return canvas.toDataURL('image/jpeg', 0.92);
  },
});
(window as unknown as { ready: boolean }).ready = true;
