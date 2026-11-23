import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('labelling page analyzes a clip frame by frame and lists its reps', async ({ page }) => {
  await page.goto('/label.html?cpu');
  await page.locator('#video-input').setInputFiles(resolve('e2e/fixtures/mannequin-pushup.webm'));
  await page.locator('select').first().selectOption('pushup');
  await page.getByTestId('analyze').click();
  await expect(page.getByTestId('reps').locator('.rep-row')).toHaveCount(3, { timeout: 120_000 });
  await expect(page.getByTestId('export')).toBeEnabled();
});
