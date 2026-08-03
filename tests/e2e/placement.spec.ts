import { expect, test, type Page } from '@playwright/test';

interface MapPoint {
  readonly x: number;
  readonly y: number;
}

async function dispatchTouchPointer(
  page: Page,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  point: MapPoint,
  pointerId: number,
): Promise<void> {
  await page.evaluate(
    ({ type, point, pointerId }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
      if (canvas === null) throw new Error('The game canvas is missing.');
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
          pointerId,
          pointerType: 'touch',
          isPrimary: true,
          button: 0,
        }),
      );
    },
    { type, point, pointerId },
  );
}

async function metric(page: Page, testId: string): Promise<number> {
  const text = await page.getByTestId(testId).textContent();
  const value = text?.match(/\d+(?:\.\d+)?/)?.[0];
  return value === undefined ? Number.NaN : Number(value);
}

async function openControls(page: Page): Promise<void> {
  const panel = page.getByTestId('controls-panel');
  if (await panel.isHidden())
    await page.getByRole('button', { name: 'Open Controls panel' }).click();
}

async function clickControl(page: Page, name: string): Promise<void> {
  await openControls(page);
  await page.getByRole('button', { name }).click();
}

async function fundOpening(page: Page, minimum = 22): Promise<void> {
  const gather = page.getByRole('button', { name: 'Gather Data plus one' });
  while ((await metric(page, 'data-metric')) < minimum) await gather.click();
}

async function openBuild(page: Page): Promise<void> {
  await fundOpening(page);
  await page.getByRole('button', { name: 'Open Build menu' }).click();
  await expect(page.getByTestId('build-panel')).toBeVisible();
}

async function findValidMapPoint(
  page: Page,
  kind: 'Living' | 'Working' | 'Services',
): Promise<MapPoint> {
  const canvas = page.locator('#game-canvas');
  const bounds = await canvas.boundingBox();
  if (bounds === null) throw new Error('The game canvas is not measurable.');
  const candidates = [
    { x: 0.54, y: 0.1 },
    { x: 0.66, y: 0.14 },
    { x: 0.78, y: 0.18 },
    { x: 0.9, y: 0.22 },
    { x: 0.7, y: 0.26 },
    { x: 0.84, y: 0.28 },
    { x: 0.94, y: 0.28 },
    { x: 0.78, y: 0.32 },
    { x: 0.9, y: 0.32 },
    { x: 0.98, y: 0.34 },
    { x: 0.76, y: 0.36 },
    { x: 0.88, y: 0.36 },
    { x: 0.96, y: 0.38 },
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
    { x: 0.54, y: 0.1 },
    { x: 0.66, y: 0.14 },
    { x: 0.78, y: 0.18 },
    { x: 0.9, y: 0.22 },
    { x: 0.7, y: 0.26 },
    { x: 0.84, y: 0.28 },
    { x: 0.94, y: 0.28 },
    { x: 0.78, y: 0.32 },
    { x: 0.9, y: 0.32 },
    { x: 0.98, y: 0.34 },
    { x: 0.76, y: 0.36 },
    { x: 0.88, y: 0.36 },
    { x: 0.96, y: 0.38 },
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

async function placeWithMouse(
  page: Page,
  kind: 'Living' | 'Working' | 'Services',
): Promise<MapPoint> {
  await openBuild(page);
  await page.getByRole('button', { name: `Choose ${kind} district seed` }).click();
  await expect(page.getByTestId('placement-status')).toContainText(`${kind} placement mode`);
  const point = await findValidMapPoint(page, kind);
  await page.mouse.click(point.x, point.y);
  const confirmButton = page.locator('[data-action="confirm-placement"]');
  await expect(confirmButton).toBeVisible();
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  return point;
}

test('Build opens and closes with only Living and Working seed choices', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open Build menu' })).toBeVisible();
  await openBuild(page);
  await expect(page.getByRole('button', { name: 'Choose Living district seed' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose Working district seed' })).toBeVisible();
  await expect(page.locator('[data-build-kind="services"]')).toBeHidden();
  await expect(page.getByTestId('living-cost')).toHaveText('10 Data');
  await expect(page.getByTestId('working-cost')).toHaveText('12 Data');
  await page.getByRole('button', { name: 'Close Build menu' }).click();
  await expect(page.getByTestId('build-panel')).toBeHidden();
  await page.getByRole('button', { name: 'Open Research menu' }).click();
  await expect(page.getByTestId('services-core-card')).toBeVisible();
  await expect(page.getByTestId('core-status')).toHaveText('Needs prerequisites');
  await expect(page.locator('[data-action="confirm-core"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Close Research menu' }).click();
});

test('Build and Research remain mutually exclusive without spending on preview', async ({
  page,
}) => {
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  await openBuild(page);
  const dataBefore = await metric(page, 'data-metric');
  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  await expect(page.getByTestId('placement-status')).toContainText('Living placement mode');

  await page.getByRole('button', { name: 'Open Research menu' }).click();
  await expect(page.getByTestId('build-panel')).toBeHidden();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  expect(await metric(page, 'data-metric')).toBe(dataBefore);

  await page.getByRole('button', { name: 'Open Build menu' }).click();
  await expect(page.getByTestId('research-panel')).toBeHidden();
  await expect(page.getByTestId('build-panel')).toBeVisible();
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
  await clickControl(page, 'Pause simulation');
  await fundOpening(page);
  const beforeLiving = await metric(page, 'data-metric');
  const livingPoint = await placeWithMouse(page, 'Living');
  await expect(page.getByTestId('status')).toContainText('Living seed accepted');
  await expect(page.getByTestId('seed-count')).toHaveText('1 seed');
  await expect(page.getByTestId('living-cost')).toHaveText('13 Data');
  expect(beforeLiving - (await metric(page, 'data-metric'))).toBe(10);

  await page.mouse.click(livingPoint.x, livingPoint.y);
  await expect(page.locator('[data-action="confirm-placement"]')).toBeVisible();
  await expect(page.locator('[data-action="confirm-placement"]')).toBeDisabled();
  await expect(page.getByTestId('placement-reason')).toContainText('already has a district seed');
  await expect(page.getByTestId('data-metric')).toHaveText(String(beforeLiving - 10));

  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  const workingPoint = await findValidMapPoint(page, 'Working');
  await page.mouse.click(workingPoint.x, workingPoint.y);
  await expect(page.locator('[data-action="confirm-placement"]')).toBeEnabled();
  await page.locator('[data-action="confirm-placement"]').click();
  await expect(page.getByTestId('status')).toContainText('Working seed accepted');
  await expect(page.getByTestId('working-cost')).toHaveText('15 Data');
  expect(await metric(page, 'data-metric')).toBe(beforeLiving - 10 - 12);
  await expect(page.locator('[data-action="gather-data"]')).toBeHidden();

  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  const insufficientPoint = await findMapPointWithStatus(page, 'Not enough Data');
  await page.mouse.click(insufficientPoint.x, insufficientPoint.y);
  await expect(page.locator('[data-action="confirm-placement"]')).toBeDisabled();
  await expect(page.getByTestId('status')).toContainText('Not enough Data');
  await expect(page.getByTestId('seed-count')).toHaveText('2 seeds');

  await page.getByRole('button', { name: 'Cancel placement' }).click();
  await expect(page.getByTestId('placement-status')).toContainText('Choose Living or Working');
  await expect(page.getByRole('button', { name: 'Cancel placement' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('mouse drag never submits a district seed', async ({ page }) => {
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  await openBuild(page);
  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  const point = await findValidMapPoint(page, 'Living');
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 24, point.y + 18);
  await page.mouse.up();
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('placement-status')).toContainText('Drag canceled');
});

test('pointercancel and an unmatched pointerup never submit a seed', async ({ page }) => {
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  await openBuild(page);
  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  const point = await findValidMapPoint(page, 'Living');

  await dispatchTouchPointer(page, 'pointerup', point, 701);
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');

  await dispatchTouchPointer(page, 'pointerdown', point, 702);
  await dispatchTouchPointer(page, 'pointercancel', point, 702);
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('placement-status')).toContainText('Pointer canceled');
});

test('touch drag never submits a district seed', async ({ page }) => {
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  await openBuild(page);
  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  const point = await findValidMapPoint(page, 'Working');
  await dispatchTouchPointer(page, 'pointerdown', point, 703);
  await dispatchTouchPointer(page, 'pointermove', { x: point.x + 20, y: point.y + 20 }, 703);
  await dispatchTouchPointer(page, 'pointerup', { x: point.x + 20, y: point.y + 20 }, 703);
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
});

test('cancel and reset clear an active pointer gesture and preview', async ({ page }) => {
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  await openBuild(page);
  await page.getByRole('button', { name: 'Choose Living district seed' }).click();
  const point = await findValidMapPoint(page, 'Living');
  await dispatchTouchPointer(page, 'pointerdown', point, 704);
  await page.getByRole('button', { name: 'Cancel placement' }).click();
  await dispatchTouchPointer(page, 'pointerup', point, 704);
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('placement-status')).toContainText('Choose Living or Working');

  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  const resetPoint = await findValidMapPoint(page, 'Working');
  await dispatchTouchPointer(page, 'pointerdown', resetPoint, 705);
  await clickControl(page, 'Reset simulation');
  await dispatchTouchPointer(page, 'pointerup', resetPoint, 705);
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('build-panel')).toBeHidden();
});

test('accepted Living seed renders autonomous construction, then reset clears it', async ({
  page,
}) => {
  await page.goto('/?simStepMs=50');
  await clickControl(page, 'Pause simulation');
  await placeWithMouse(page, 'Living');
  await clickControl(page, 'Run at normal speed');
  await expect.poll(() => metric(page, 'project-count'), { timeout: 7_000 }).toBeGreaterThan(0);
  await clickControl(page, 'Run at fast speed');
  await expect.poll(() => metric(page, 'building-count'), { timeout: 7_000 }).toBeGreaterThan(0);

  await clickControl(page, 'Pause simulation');
  await clickControl(page, 'Reset simulation');
  await expect(page.getByTestId('tick')).toHaveText('0');
  await expect(page.getByTestId('seed-count')).toHaveText('0 seeds');
  await expect(page.getByTestId('building-count')).toHaveText('0 buildings');
  await expect(page.getByTestId('citizen-count')).toHaveText('1');
});

test('Services Core unlocks mouse and touch Services placement', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/?e2eFixture=services&simStepMs=50');
  await clickControl(page, 'Pause simulation');
  await placeWithMouse(page, 'Living');

  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  const workingPoint = await findValidMapPoint(page, 'Working');
  await page.mouse.click(workingPoint.x, workingPoint.y);
  await page.locator('[data-action="confirm-placement"]').click();
  await expect(page.getByTestId('status')).toContainText('Working seed accepted');
  await page.getByRole('button', { name: 'Close Build menu' }).click();

  await page.getByRole('button', { name: 'Open Research menu' }).click();
  await expect(page.getByTestId('core-requirements')).toContainText(
    'Completed work activities: 0/40',
  );
  await expect(page.locator('[data-action="confirm-core"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Close Research menu' }).click();

  await clickControl(page, 'Run at fast speed');
  await page.getByRole('button', { name: 'Open Research menu' }).click();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await expect(page.getByTestId('core-requirements')).toContainText('Population: 20/20', {
    timeout: 120_000,
  });
  await expect(page.getByTestId('core-requirements')).toContainText(
    'Completed work activities: 40/40',
    { timeout: 120_000 },
  );
  await expect
    .poll(() => metric(page, 'data-metric'), { timeout: 120_000 })
    .toBeGreaterThanOrEqual(50);

  await page.locator('[data-research-focus="activity"]').click();
  await expect(page.locator('[data-action="confirm-core"]')).toBeEnabled();
  await page.locator('[data-action="confirm-core"]').click();
  await expect(page.getByTestId('core-status')).toContainText('Installed');
  await expect(page.getByTestId('core-status')).toContainText('Activity');

  await expect
    .poll(() => metric(page, 'data-metric'), { timeout: 120_000 })
    .toBeGreaterThanOrEqual(20);
  await page.getByRole('button', { name: 'Open Build menu' }).click();
  await expect(page.getByRole('button', { name: 'Choose Services district seed' })).toBeVisible();
  await expect(page.getByTestId('services-cost')).toHaveText('20 Data');
  await page.getByRole('button', { name: 'Choose Services district seed' }).click();
  const mouseServicesPoint = await findValidMapPoint(page, 'Services');
  await page.mouse.click(mouseServicesPoint.x, mouseServicesPoint.y);
  await expect(page.locator('[data-action="confirm-placement"]')).toBeEnabled();
  await page.locator('[data-action="confirm-placement"]').click();
  await expect(page.getByTestId('status')).toContainText('Services seed accepted');

  await expect
    .poll(() => metric(page, 'data-metric'), { timeout: 120_000 })
    .toBeGreaterThanOrEqual(25);
  await page.getByRole('button', { name: 'Choose Services district seed' }).click();
  const touchServicesPoint = await findValidMapPoint(page, 'Services');
  await dispatchTouchPointer(page, 'pointerdown', touchServicesPoint, 901);
  await dispatchTouchPointer(page, 'pointerup', touchServicesPoint, 901);
  await expect(page.locator('[data-action="confirm-placement"]')).toBeEnabled();
  await page.locator('[data-action="confirm-placement"]').click();
  await expect(page.getByTestId('status')).toContainText('Services seed accepted');
});

test.describe('touch viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('touch placement uses the same accessible Build flow', async ({ page }) => {
    await page.goto('/');
    await openControls(page);
    await page.getByRole('button', { name: 'Pause simulation' }).tap();
    await openBuild(page);
    await page.getByRole('button', { name: 'Choose Working district seed' }).tap();
    const point = await findValidMapPoint(page, 'Working');
    await dispatchTouchPointer(page, 'pointerdown', point, 706);
    await dispatchTouchPointer(page, 'pointerup', point, 706);
    const confirmButton = page.locator('[data-action="confirm-placement"]');
    await expect(confirmButton).toBeEnabled();
    await confirmButton.tap();
    await expect(page.getByTestId('status')).toContainText('Working seed accepted');
    await expect(page.getByTestId('seed-count')).toHaveText('1 seed');
    await expect(page.getByRole('button', { name: 'Cancel placement' })).toBeVisible();
  });
});

interface TestViewport {
  readonly width: number;
  readonly height: number;
  readonly label: string;
}

async function assertResponsivePlacement(page: Page, viewport: TestViewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto('/');
  await clickControl(page, 'Pause simulation');
  const hudBounds = await page.locator('.hud').boundingBox();
  expect(hudBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((hudBounds?.x ?? 0) + (hudBounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect(hudBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((hudBounds?.y ?? 0) + (hudBounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
  await expect(page.getByTestId('citizen-count')).toBeVisible();
  await expect(page.getByTestId('data-metric')).toBeVisible();
  const initialCanvasBounds = await page.locator('#game-canvas').boundingBox();
  expect(initialCanvasBounds?.height ?? 0).toBeGreaterThan(180);
  await page.getByRole('button', { name: 'Open Research menu' }).click();
  await expect(page.getByTestId('research-panel')).toBeVisible();
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open Controls panel' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('citizen-count')).toBeVisible();
  await expect(page.getByTestId('data-metric')).toBeVisible();
  const researchBounds = await page.getByTestId('research-panel').boundingBox();
  expect(researchBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((researchBounds?.x ?? 0) + (researchBounds?.width ?? 0)).toBeLessThanOrEqual(
    viewport.width,
  );
  expect(researchBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((researchBounds?.y ?? 0) + (researchBounds?.height ?? 0)).toBeLessThanOrEqual(
    viewport.height,
  );
  await page.getByRole('button', { name: 'Close Research menu' }).click();
  await openBuild(page);
  await expect(page.getByTestId('controls-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open Controls panel' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.getByTestId('citizen-count')).toBeVisible();
  await expect(page.getByTestId('data-metric')).toBeVisible();
  const buildBounds = await page.getByTestId('build-panel').boundingBox();
  expect(buildBounds?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((buildBounds?.x ?? 0) + (buildBounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
  expect(buildBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect((buildBounds?.y ?? 0) + (buildBounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
  for (const name of [
    'Close Build menu',
    'Open Research menu',
    'Gather Data plus one',
    'Open Controls panel',
  ]) {
    const bounds = await page.getByRole('button', { name }).boundingBox();
    expect(bounds?.height ?? 0).toBeGreaterThanOrEqual(44);
  }

  const canvas = page.locator('#game-canvas');
  const canvasBounds = await canvas.boundingBox();
  expect(canvasBounds?.width ?? 0).toBeGreaterThan(0);
  expect(canvasBounds?.height ?? 0).toBeGreaterThan(0);

  let workingPoint: MapPoint | undefined;
  for (const [index, [kind, cost]] of (
    [
      ['Living', 10],
      ['Working', 12],
    ] as const
  ).entries()) {
    if (index > 0) {
      await page.getByRole('button', { name: 'Close Build menu' }).click();
      await clickControl(page, 'Reset simulation');
      await openBuild(page);
    }
    await page.getByRole('button', { name: `Choose ${kind} district seed` }).click();
    const point = await findValidMapPoint(page, kind);
    if (kind === 'Working') workingPoint = point;
    await page.mouse.click(point.x, point.y);

    const confirmButton = page.locator('[data-action="confirm-placement"]');
    const cancelButton = page.locator('[data-action="cancel-placement"]');
    await expect(confirmButton).toBeVisible();
    await expect(cancelButton).toBeVisible();
    await expect(confirmButton).toBeEnabled();

    for (const button of [confirmButton, cancelButton]) {
      const bounds = await button.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect(bounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(viewport.height);
    }

    const before = await metric(page, 'data-metric');
    await confirmButton.click();
    await expect(page.getByTestId('status')).toContainText(`${kind} seed accepted`);
    expect(before - (await metric(page, 'data-metric'))).toBe(cost);
  }

  await page.getByRole('button', { name: 'Choose Working district seed' }).click();
  if (workingPoint === undefined) throw new Error('The responsive Working point was not saved.');
  const invalidPoint = workingPoint;
  await page.mouse.click(invalidPoint.x, invalidPoint.y);
  const disabledConfirm = page.locator('[data-action="confirm-placement"]');
  await expect(disabledConfirm).toBeVisible();
  await expect(disabledConfirm).toBeDisabled();
  await expect(page.locator('[data-action="cancel-placement"]')).toBeVisible();
  await expect(page.getByTestId('placement-reason')).toContainText('already has a district seed');

  const layout = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await page.locator('[data-action="cancel-placement"]').click();
}

test.describe('responsive Build action dock', () => {
  const viewports: readonly TestViewport[] = [
    { width: 320, height: 568, label: '320x568' },
    { width: 360, height: 640, label: '360x640' },
    { width: 390, height: 844, label: '390x844' },
    { width: 768, height: 600, label: '768x600' },
    { width: 1280, height: 800, label: 'desktop' },
  ];

  for (const viewport of viewports) {
    test(`keeps the Build action dock usable at ${viewport.label}`, async ({ page }) => {
      await assertResponsivePlacement(page, viewport);
    });
  }
});
