import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// The fixture is a drawn mannequin doing 3 push-ups, rendered by scripts/make-mannequin-video.mjs.
// It checks the whole pipeline (video → MediaPipe in the browser → analyzer → UI); accuracy on real
// lifters is measured separately, on labelled footage.
const VIDEO = resolve('e2e/fixtures/mannequin-pushup.webm');

test('analyzes an uploaded video, makes a highlight clip, and saves the set to history', async ({ page }) => {
  await page.goto('/?cpu');
  await page.getByTestId('exercise-picker').getByRole('button', { name: 'Push-up' }).click();
  await page.getByTestId('file-input').setInputFiles(VIDEO);
  await expect(page.getByTestId('perf')).toContainText('fps', { timeout: 60_000 });
  await expect(page.locator('.summary')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2 })).toContainText('3 push-ups');
  await expect(page.locator('tbody tr')).toHaveCount(3);

  await page.getByTestId('make-clip').click();
  const clip = page.getByTestId('clip');
  await expect(clip).toBeVisible({ timeout: 90_000 });
  await expect.poll(() => clip.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByTestId('history')).toContainText('3 reps');
  await expect(page.getByTestId('bests')).toContainText('Most reps in a set');
});

test('recognises the exercise on its own in Auto mode', async ({ page }) => {
  await page.goto('/?cpu');
  await page.getByTestId('exercise-picker').getByRole('button', { name: 'Auto' }).click();
  await page.getByTestId('file-input').setInputFiles(VIDEO);
  await expect(page.getByTestId('detected')).toContainText('Push-up', { timeout: 90_000 });
  await expect(page.locator('.summary')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2 })).toContainText('push-ups');
});
