import { expect, test, type Page } from '@playwright/test';

interface MapPoint {
  readonly x: number;
  readonly y: number;
}

async function metric(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).textContent();
  const value = text?.match(/\d+(?:\.\d+)?/)?.[0];
  return value === undefined ? Number.NaN : Number(value);
}

async function openBuild(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open Build menu' }).click();
  await expect(page.getByTestId('build-panel')).toBeVisible();
}

async function findValidMapPoint(page: Page, kind: 'Living' | 'Working'): Promise<MapPoint> {
  const canvas = page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('The game canvas is not measurable.');
  const candidates = [
    { x: 0.54, y: 0.32 },
    { x: 0.66, y: 0.36 },
    { x: 0.78, y: 0.4 },
    { x: 0.9, y: 0.45 },
    { x: 0.7, y: 0.5 },
    { x: 0.86, y: 0.54 },
    { x: 0.48, y: 0.58 },
    { x: 0.62, y: 0.62 },
    { x: 0.78, y: 0.66 },
    { x: 0.42, y: 0.74 },
    { x: 0.66, y: 0.78 },
    { x: 0.84, y: 0.82 },
    { x: 0.55, y: 0.9 },
  ];
  const statuses: string[] = [];
  for (const candidate of candidates) {
    const point = {
      x: bounds.x + bounds.width * candidate.x,
      y: bounds.y + bounds.height * candidate.y,
    };
    await page.mouse.move(point.x, point.y);
    const status = await page.getByTestId('placement-status').textContent();
    statuses.push(status ?? '');
    if (status?.includes(`Valid ${kind}`)) return point;
  }
  throw new Error(
    `No valid ${kind} map point was found in the visible canvas: ${statuses.join(' | ')}`,
  );
}

async function findMapPointWithStatus(page: Page, message: string): Promise<MapPoint> {
  const canvas = page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('The game canvas is not measurable.');
  const candidates = [
    { x: 0.54, y: 0.32 },
    { x: 0.66, y: 0.36 },
    { x: 0.78, y: 0.4 },
    { x: 0.9, y: 0.45 },
    { x: 0.7, y: 0.5 },
    { x: 0.86, y: 0.54 },
    { x: 0.48, y: 0.58 },
    { x: 0.62, y: 0.62 },
    { x: 0.78, y: 0.66 },
    { x: 0.42, y: 0.74 },
    { x: 0.66, y: 0.78 },
    { x: 0.84, y: 0.82 },
    { x: 0.55, y: 0.9 },
  ];
  for (const candidate of candidates) {
    const point = {
      x: bounds.x + bounds.width * candidate.x,
      y: bounds.y + bounds.height * candidate.y,
    };
    await page.mouse.move(point.x, point.y);
    if ((await page.getByTestId('placement-status').textContent())?.includes(message)) return point;
  }
  throw new Error(`No map point with status ${message} was found.`);
}

async function placeWithMouse(page: Page, kind: 'Living' | 'Working'): Promise<MapPoint> {
  await openBuild(page);
  await page.getByRole('button', { name: `Choose ${kind} district seed` }).click();
  await expect(page.getByTestId('placement-status')).toContainText(`${kind} placement mode`);
  const point = await findValidMapPoint(page, kind);
  await page.mouse.click(point.x, point.y);
  return point;
}

test('Build opens and closes with only Living and Working seed choices', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Build menu' })).toBeVisible();
  await openBuild(page);
  await expect(page.getByRole('button', { name: 'Choose Living district seed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Working district seed' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Services/ })).toHaveCount(0);
  await expect(page.getByTestId('living-cost')).toHaveText('10 Data');
  await expect(page.getByTestId('working-cost')).toHaveText('12 Data');
  await page.getByRole('button', { name: 'Close Build menu' }).click();
  await expect(page.getByTestId('build-panel')).toBeHidden();
});

test('mouse placement previews, charges the exact cost, rejects duplicates and insufficient Data, and cancels', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  const beforeLiving = await metric(page, 'data-metric');
  const livingPoint = await placeWithMouse(page, 'Living');
  await expect(page.getByTestId('status')).toContainText('Living seed accepted');
  await expect(page.getByTestId('seed-count')).toHaveText('1 seed');
  expect(beforeLiving - (await metric(page, 'data-metric'))).toBe(10);

  await page.mouse.click(livingPoint.x, livingPoint.y);
  await expect(page.getByTestId('status')).toContainText('already has a district seed');
  await expect(page.getByTestId('data-metric')).toHaveText(String(beforeLiving - 10));

  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  const workingPoint = await findValidMapPoint(page, 'Working');
  await page.mouse.click(workingPoint.x, workingPoint.y);
  await expect(page.getByTestId('status')).toContainText('Working seed accepted');
  expect(await metric(page, 'data-metric')).toBe(beforeLiving - 10 - 12);

  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  const insufficientPoint = await findMapPointWithStatus(page, 'Not enough Data');
  await page.mouse.click(insufficientPoint.x, insufficientPoint.y);
  await expect(page.getByTestId('status')).toContainText('Not enough Data');
  await expect(page.getByTestId('seed-count')).toHaveText('2 seeds');

  await page.getByRole('button', { name: 'Cancel placement' }).click();
  await expect(page.getByTestId('placement-status')).toContainText('Choose Living or Working');
  await expect(page.getByRole('button', { name: 'Cancel placement' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('accepted seed renders autonomous construction and population growth, then reset clears it', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await placeWithMouse(page, 'Living');
  await page.getByRole('button', { name: 'Run at normal speed' }).click();
  await expect.poll(() => metric(page, 'project-count'), { timeout: 7_000 }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Run at fast speed' }).click();
  await expect.poll(() => metric(page, 'building-count'), { timeout: 7_000 }).toBeGreaterThan(2);
  await expect.poll(() => metric(page, 'citizen-count'), { timeout: 7_000 }).toBeGreaterThan(10);

  await page.getByRole('button', { name: 'Pause simulation' }).click();
  await page.getByRole('button', { name: 'Reset simulation' }).click();
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('building-count')).toHaveText('2 buildings');
  await expect(page.getByTestId('citizen-count')).toHaveText('10');
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('touch placement uses the same accessible Build flow', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Pause simulation' }).tap();
    await openBuild(page);
    await page.getByRole('button', { name: 'Choose Working district seed' }).tap();
    const point = await findValidMapPoint(page, 'Working');
    const canvas = page.locator('#game-canvas');
    const bounds = await canvas.boundingBox();
    if (bounds === null) throw new Error('The game canvas is not measurable.');
    await canvas.tap({ position: { x: point.x - bounds.x, y: point.y - bounds.y } });
    await expect(page.getByTestId('status')).toContainText('Working seed accepted');
    await expect(page.getByTestId('seed-count')).toHaveText('1 seed');
    await expect(page.getByRole('button', { name: 'Cancel placement' })).toBeVisible();
  });
});
