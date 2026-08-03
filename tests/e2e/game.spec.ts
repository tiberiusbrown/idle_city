import { expect, test, type Page } from '@playwright/test';

async function tick(page: Page): Promise<number> {
  return Number(await page.getByTestId('tick').textContent());
}

async function openControls(page: Page): Promise<void> {
  const panel = page.getByTestId('controls-panel');
  if (await panel.isHidden())
    await page.getByRole('button', { name: 'Open Controls panel' }).click();
}

test('loads the voxel simulation without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Idle City' })).toBeVisible();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open Controls panel' })).toHaveAttribute(
    'aria-controls',
    'controls-panel',
  );
  await page.getByRole('button', { name: 'Open Controls panel' }).click();
  await expect(page.getByTestId('controls-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close Controls panel' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await page.getByRole('button', { name: 'Close Controls panel' }).click();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Open Controls panel' }).click();
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('project-count')).toHaveText('0 projects');
  await page.getByRole('button', { name: 'Close Controls panel' }).click();
  await expect(page.getByTestId('status')).toContainText('normal speed');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await expect(page.getByTestId('citizen-count')).toHaveText('1');
  await expect(page.getByTestId('building-count')).toHaveText('0 buildings');
  await expect(page.getByRole('button', { name: 'Gather Data plus one' })).toBeVisible();
  await expect(page.getByTestId('citizen-count')).toHaveText('1');
  await expect(page.getByTestId('data-metric')).toHaveText(/\d+(\.\d+)?/);
  await expect(page.getByTestId('space-metric')).toHaveText(/\d+%/);
  await expect(page.getByTestId('access-metric')).toHaveText(/\d+%/);
  await expect(page.getByTestId('activity-metric')).toHaveText(/\d+%/);
  await expect.poll(() => tick(page)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('pause, speed, and reset controls govern logical ticks', async ({ page }) => {
  await page.goto('/');
  await openControls(page);
  await expect.poll(() => tick(page)).toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const paused = await tick(page);
  await page.waitForTimeout(700);
  expect(await tick(page)).toBe(paused);

  await page.getByRole('button', { name: 'Run at normal speed' }).click();
  const normalStart = await tick(page);
  await page.waitForTimeout(850);
  const normalDelta = (await tick(page)) - normalStart;
  expect(normalDelta).toBeGreaterThanOrEqual(3);

  await page.getByRole('button', { name: 'Run at fast speed' }).click();
  const fastStart = await tick(page);
  await page.waitForTimeout(850);
  const fastDelta = (await tick(page)) - fastStart;
  expect(fastDelta).toBeGreaterThan(normalDelta * 2);

  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.getByRole('button', { name: 'Reset simulation' }).click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('citizen-count')).toHaveText('1');
});

test('gathers exactly one manual Data per activation', async ({ page }) => {
  await page.goto('/');
  await openControls(page);
  const gather = page.getByRole('button', { name: 'Gather Data plus one' });
  await expect(page.getByTestId('data-metric')).toHaveText('0');
  await gather.click();
  await expect(page.getByTestId('data-metric')).toHaveText('1');
  await expect(page.getByTestId('status')).toContainText('Gathered +1 Data');
  await gather.click();
  await expect(page.getByTestId('data-metric')).toHaveText('2');
});

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('main controls remain usable on a mobile viewport', async ({ page }) => {
  await page.goto('/');
  await openControls(page);
  for (const name of [
    'Pause simulation',
    'Run at normal speed',
    'Run at fast speed',
    'Reset simulation',
  ]) {
    await expect(page.getByRole('button', { name })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Pause simulation' }).tap();
  await expect(page.getByTestId('status')).toContainText('paused');
  await expect(page.getByRole('button', { name: 'Gather Data plus one' })).toBeVisible();
});
