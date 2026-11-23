import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// The fixture is a drawn mannequin doing 3 push-ups, rendered by scripts/make-mannequin-video.mjs.
// It checks the whole pipeline (video → MediaPipe in the browser → analyzer → UI); accuracy on real
// lifters is measured separately, on labelled footage.
const VIDEO = resolve('e2e/fixtures/mannequin-pushup.webm');

test('analyzes an uploaded video and shows a set summary', async ({ page }) => {
  await page.goto('/?cpu');
  await page.getByRole('button', { name: 'Push-up' }).click();
  await page.getByTestId('file-input').setInputFiles(VIDEO);
  await expect(page.getByTestId('perf')).toContainText('fps', { timeout: 60_000 });
  await expect(page.locator('.summary')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { level: 2 })).toContainText('3 push-ups');
  await expect(page.locator('tbody tr')).toHaveCount(3);
});
