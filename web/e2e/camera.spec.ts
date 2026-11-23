import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

// Chromium's fake camera plays the mannequin clip (made in global-setup.ts) on a loop.
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${resolve('e2e/fixtures/mannequin-pushup.mjpeg')}`,
    ],
  },
});

test('tracks a person from the camera and counts reps', async ({ page }) => {
  await page.goto('/?cpu');
  await page.getByTestId('exercise-picker').getByRole('button', { name: 'Push-up' }).click();
  await page.getByRole('button', { name: 'Start camera' }).click();
  await expect(page.getByTestId('perf')).toContainText('fps', { timeout: 60_000 });
  await expect
    .poll(async () => Number(await page.getByTestId('rep-count').locator('.count-n').textContent()), { timeout: 60_000 })
    .toBeGreaterThanOrEqual(2);
  await page.getByTestId('end-set').click();
  await expect(page.locator('.summary')).toBeVisible();
});
