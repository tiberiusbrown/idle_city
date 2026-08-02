import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene, type PickedLogicalCell } from '@idle-city/renderer';
import {
  createSimulation,
  type CommandRejectionReason,
  type DistrictSeedKind,
  type SimulationSnapshot,
} from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { updateSimulationView } from './view-update';

type PlaceableDistrictSeedKind = Extract<DistrictSeedKind, 'living' | 'working'>;

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const tickElement = document.querySelector<HTMLElement>('[data-testid="tick"]');
const citizenElement = document.querySelector<HTMLElement>('[data-testid="citizen-count"]');
const dataElement = document.querySelector<HTMLElement>('[data-testid="data-metric"]');
const spaceElement = document.querySelector<HTMLElement>('[data-testid="space-metric"]');
const accessElement = document.querySelector<HTMLElement>('[data-testid="access-metric"]');
const activityElement = document.querySelector<HTMLElement>('[data-testid="activity-metric"]');
const statusElement = document.querySelector<HTMLElement>('[data-testid="status"]');
const seedCountElement = document.querySelector<HTMLElement>('[data-testid="seed-count"]');
const buildingCountElement = document.querySelector<HTMLElement>('[data-testid="building-count"]');
const projectCountElement = document.querySelector<HTMLElement>('[data-testid="project-count"]');
const buildButton = document.querySelector<HTMLButtonElement>('[data-action="build"]');
const buildPanel = document.querySelector<HTMLElement>('[data-testid="build-panel"]');
const placementStatusElement = document.querySelector<HTMLElement>(
  '[data-testid="placement-status"]',
);
const placementCostElement = document.querySelector<HTMLElement>('[data-testid="placement-cost"]');
const buildDataElement = document.querySelector<HTMLElement>('[data-testid="build-data"]');
const cancelPlacementButton = document.querySelector<HTMLButtonElement>(
  '[data-action="cancel-placement"]',
);
const livingCostElement = document.querySelector<HTMLElement>('[data-testid="living-cost"]');
const workingCostElement = document.querySelector<HTMLElement>('[data-testid="working-cost"]');
const buildKindButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-build-kind]')];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed]')];
const resetButton = document.querySelector<HTMLButtonElement>('[data-action="reset"]');

if (
  canvas === null ||
  tickElement === null ||
  citizenElement === null ||
  dataElement === null ||
  spaceElement === null ||
  accessElement === null ||
  activityElement === null ||
  statusElement === null ||
  seedCountElement === null ||
  buildingCountElement === null ||
  projectCountElement === null ||
  buildButton === null ||
  buildPanel === null ||
  placementStatusElement === null ||
  placementCostElement === null ||
  buildDataElement === null ||
  cancelPlacementButton === null ||
  livingCostElement === null ||
  workingCostElement === null ||
  resetButton === null
) {
  throw new Error('Required game shell elements are missing.');
}

const tickDisplay = tickElement;
const citizenDisplay = citizenElement;
const dataDisplay = dataElement;
const spaceDisplay = spaceElement;
const accessDisplay = accessElement;
const activityDisplay = activityElement;
const statusDisplay = statusElement;
const gameCanvas = canvas;
const seedCountDisplay = seedCountElement;
const buildingCountDisplay = buildingCountElement;
const projectCountDisplay = projectCountElement;
const buildToggle = buildButton;
const buildMenu = buildPanel;
const placementStatusDisplay = placementStatusElement;
const placementCostDisplay = placementCostElement;
const buildDataDisplay = buildDataElement;
const livingCostDisplay = livingCostElement;
const workingCostDisplay = workingCostElement;
const cancelButton = cancelPlacementButton;

const configuration = {
  width: 12,
  height: 10,
  seed: 1234,
  citizenCount: 10,
  housingCapacity: 20,
  workplaceCapacity: 20,
  populationCap: 20,
  startingData: 24,
} as const;
let simulation = createSimulation(configuration);
const initialSnapshot = simulation.getSnapshot();
const engine = new Engine(gameCanvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, initialSnapshot);
const stepMilliseconds = 200;
let accumulator = 0;
let previousTime = performance.now();
let speed = 1;
let buildOpen = false;
let placementKind: PlaceableDistrictSeedKind | undefined;
const dragThresholdCssPixels = 8;
interface PrimaryPointerGesture {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  dragging: boolean;
}
let primaryPointerGesture: PrimaryPointerGesture | undefined;

function isPlaceableDistrictSeedKind(
  value: string | undefined,
): value is PlaceableDistrictSeedKind {
  return value === 'living' || value === 'working';
}

function formatData(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function displayKind(kind: PlaceableDistrictSeedKind): string {
  return kind === 'living' ? 'Living' : 'Working';
}

function setPlacementStatus(
  message: string,
  state: 'neutral' | 'valid' | 'invalid' = 'neutral',
): void {
  placementStatusDisplay.textContent = message;
  placementStatusDisplay.classList.toggle('valid', state === 'valid');
  placementStatusDisplay.classList.toggle('invalid', state === 'invalid');
}

function clearPrimaryPointerGesture(): void {
  const pointerId = primaryPointerGesture?.pointerId;
  primaryPointerGesture = undefined;
  if (pointerId !== undefined && gameCanvas.hasPointerCapture(pointerId)) {
    gameCanvas.releasePointerCapture(pointerId);
  }
}

function pointerMovedBeyondDragThreshold(event: PointerEvent): boolean {
  if (primaryPointerGesture === undefined) return false;
  return (
    Math.hypot(
      event.clientX - primaryPointerGesture.startClientX,
      event.clientY - primaryPointerGesture.startClientY,
    ) >= dragThresholdCssPixels
  );
}

function capturePrimaryPointer(pointerId: number): void {
  try {
    gameCanvas.setPointerCapture(pointerId);
  } catch {
    // Synthetic test events do not always have an active pointer to capture.
  }
}

function rejectionMessage(reason: CommandRejectionReason): string {
  switch (reason) {
    case 'invalid-kind':
      return 'That district type is not available.';
    case 'out-of-bounds':
      return 'Choose a whole logical cell in the city.';
    case 'inactive-chunk':
      return 'That chunk is inactive. Choose a visible active chunk.';
    case 'occupied':
      return 'That cell already has a district seed.';
    case 'locked':
      return 'That district is locked.';
    case 'insufficient-data':
      return 'Not enough Data for this seed.';
  }
}

function setSpeed(nextSpeed: number): void {
  speed = nextSpeed;
  const label =
    speed === 0 ? 'paused' : speed === 1 ? 'running at normal speed' : 'running at fast speed';
  statusDisplay.textContent = `Simulation ${label}`;
  speedButtons.forEach((button) => {
    const buttonSpeed =
      button.dataset.speed === 'pause' ? 0 : button.dataset.speed === 'normal' ? 1 : 4;
    button.classList.toggle('active', buttonSpeed === speed);
    button.setAttribute('aria-pressed', String(buttonSpeed === speed));
  });
}

function clearPlacementSelection(): void {
  clearPrimaryPointerGesture();
  placementKind = undefined;
  city.setPlacementPreview(undefined);
  buildKindButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  cancelButton.hidden = true;
  placementCostDisplay.textContent = 'Select a district to see its cost.';
  setPlacementStatus('Choose Living or Working to enter placement mode.');
  gameCanvas.setAttribute('aria-label', 'Idle City 3D simulation');
}

function setBuildOpen(open: boolean): void {
  buildOpen = open;
  buildMenu.hidden = !open;
  buildToggle.setAttribute('aria-expanded', String(open));
  buildToggle.setAttribute('aria-label', open ? 'Close Build menu' : 'Open Build menu');
  buildToggle.classList.toggle('active', open);
  if (!open) clearPlacementSelection();
}

function beginPlacement(kind: PlaceableDistrictSeedKind): void {
  setBuildOpen(true);
  clearPrimaryPointerGesture();
  city.setPlacementPreview(undefined);
  placementKind = kind;
  const cost = simulation.getCurrentDistrictSeedCost(kind);
  buildKindButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.buildKind === kind));
  });
  cancelButton.hidden = false;
  placementCostDisplay.textContent = `Current cost: ${String(cost)} Data`;
  setPlacementStatus(`${displayKind(kind)} placement mode: move over an active visible cell.`);
  gameCanvas.setAttribute(
    'aria-label',
    `${displayKind(kind)} placement mode. Choose a cell in an active visible chunk.`,
  );
}

function previewPlacementAt(picked: PickedLogicalCell | undefined): void {
  if (placementKind === undefined) return;
  if (picked === undefined) {
    city.setPlacementPreview(undefined);
    setPlacementStatus('Move over an active visible chunk to preview placement.');
    return;
  }

  const preview = simulation.previewDistrictSeed({
    kind: placementKind,
    position: picked.position,
  });
  city.setPlacementPreview({ position: picked.position, valid: preview.valid });
  const coordinates = `(${String(picked.position.x)}, ${String(picked.position.y)})`;
  if (preview.valid) {
    setPlacementStatus(`Valid ${displayKind(placementKind)} placement at ${coordinates}.`, 'valid');
  } else {
    setPlacementStatus(`${rejectionMessage(preview.reason)} Cell ${coordinates}.`, 'invalid');
  }
}

function updatePlacementAt(clientX: number, clientY: number): void {
  if (placementKind === undefined) return;
  previewPlacementAt(city.pickLogicalCell(clientX, clientY));
}

function submitPlacement(clientX: number, clientY: number, event: PointerEvent): void {
  if (placementKind === undefined) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  const picked = city.pickLogicalCell(clientX, clientY);
  if (picked === undefined) {
    setPlacementStatus('Choose a cell in an active visible chunk.', 'invalid');
    return;
  }
  const result = simulation.placeDistrictSeed({ kind: placementKind, position: picked.position });
  const coordinates = `(${String(picked.position.x)}, ${String(picked.position.y)})`;
  if (result.accepted) {
    statusDisplay.textContent = `${displayKind(placementKind)} seed accepted at ${coordinates}; spent ${String(result.cost)} Data.`;
    setPlacementStatus(
      `${displayKind(placementKind)} seed placed at ${coordinates}. Choose another cell or cancel.`,
      'valid',
    );
  } else {
    statusDisplay.textContent = `${displayKind(placementKind)} seed rejected: ${rejectionMessage(result.reason)}`;
    setPlacementStatus(`${rejectionMessage(result.reason)} Cell ${coordinates}.`, 'invalid');
  }
  const snapshot = simulation.getSnapshot();
  updateSimulationView(
    snapshot,
    1,
    (currentSnapshot, interpolation) => city.update(currentSnapshot, interpolation),
    renderHud,
  );
  updatePlacementAt(clientX, clientY);
}

function renderHud(snapshot: SimulationSnapshot): void {
  tickDisplay.textContent = String(snapshot.tick);
  citizenDisplay.textContent = String(snapshot.citizens.length);
  dataDisplay.textContent = formatData(snapshot.data);
  spaceDisplay.textContent = `${String(Math.round(snapshot.metrics.space * 100))}%`;
  accessDisplay.textContent = `${String(Math.round(snapshot.metrics.access * 100))}%`;
  activityDisplay.textContent = `${String(Math.round(snapshot.metrics.activity * 100))}%`;
  seedCountDisplay.textContent = `${String(snapshot.seeds.length)} seed${snapshot.seeds.length === 1 ? '' : 's'}`;
  buildingCountDisplay.textContent = `${String(snapshot.buildings.length)} building${snapshot.buildings.length === 1 ? '' : 's'}`;
  projectCountDisplay.textContent = `${String(snapshot.constructionProjects.length)} project${snapshot.constructionProjects.length === 1 ? '' : 's'}`;
  livingCostDisplay.textContent = `${String(simulation.getCurrentDistrictSeedCost('living'))} Data`;
  workingCostDisplay.textContent = `${String(simulation.getCurrentDistrictSeedCost('working'))} Data`;
  buildDataDisplay.textContent = `Data available: ${formatData(snapshot.data)}`;
  if (placementKind !== undefined) {
    placementCostDisplay.textContent = `Current cost: ${String(simulation.getCurrentDistrictSeedCost(placementKind))} Data`;
  }
}

speedButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setSpeed(button.dataset.speed === 'pause' ? 0 : button.dataset.speed === 'normal' ? 1 : 4);
  });
});

buildToggle.addEventListener('click', () => {
  if (buildOpen) {
    setBuildOpen(false);
    statusDisplay.textContent = 'Build menu closed.';
  } else {
    setBuildOpen(true);
    statusDisplay.textContent = 'Build menu open. Choose Living or Working.';
  }
});

buildKindButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.buildKind;
    if (!isPlaceableDistrictSeedKind(kind)) return;
    beginPlacement(kind);
  });
});

cancelButton.addEventListener('click', () => {
  clearPlacementSelection();
  statusDisplay.textContent = 'Placement canceled.';
});

gameCanvas.addEventListener('pointermove', (event) => {
  if (placementKind === undefined) return;
  if (primaryPointerGesture !== undefined && event.pointerId !== primaryPointerGesture.pointerId) {
    return;
  }
  if (primaryPointerGesture !== undefined && pointerMovedBeyondDragThreshold(event)) {
    primaryPointerGesture.dragging = true;
  }
  updatePlacementAt(event.clientX, event.clientY);
});
gameCanvas.addEventListener('pointerleave', () => {
  if (placementKind === undefined) return;
  if (primaryPointerGesture !== undefined) return;
  city.setPlacementPreview(undefined);
  setPlacementStatus('Move over an active visible chunk to preview placement.');
});
gameCanvas.addEventListener('pointerdown', (event) => {
  if (placementKind === undefined || primaryPointerGesture !== undefined) return;
  if (!event.isPrimary) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  primaryPointerGesture = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    dragging: false,
  };
  capturePrimaryPointer(event.pointerId);
  updatePlacementAt(event.clientX, event.clientY);
});
gameCanvas.addEventListener('pointerup', (event) => {
  if (placementKind === undefined || primaryPointerGesture?.pointerId !== event.pointerId) return;
  const wasDrag = primaryPointerGesture.dragging || pointerMovedBeyondDragThreshold(event);
  clearPrimaryPointerGesture();
  if (wasDrag) {
    setPlacementStatus('Drag canceled; no district seed was placed.', 'neutral');
    return;
  }
  submitPlacement(event.clientX, event.clientY, event);
});
gameCanvas.addEventListener('pointercancel', (event) => {
  if (primaryPointerGesture?.pointerId !== event.pointerId) return;
  clearPrimaryPointerGesture();
  city.setPlacementPreview(undefined);
  setPlacementStatus('Pointer canceled; no district seed was placed.', 'neutral');
});
gameCanvas.addEventListener('lostpointercapture', (event) => {
  if (primaryPointerGesture?.pointerId !== event.pointerId) return;
  clearPrimaryPointerGesture();
});

resetButton.addEventListener('click', () => {
  simulation = createSimulation(configuration);
  accumulator = 0;
  previousTime = performance.now();
  setBuildOpen(false);
  const snapshot = simulation.getSnapshot();
  updateSimulationView(
    snapshot,
    1,
    (currentSnapshot, interpolation) => city.update(currentSnapshot, interpolation),
    renderHud,
  );
});

engine.runRenderLoop(() => {
  const now = performance.now();
  const elapsed = Math.min(now - previousTime, 1000);
  previousTime = now;
  accumulator += elapsed * speed;
  while (accumulator >= stepMilliseconds) {
    simulation.step();
    accumulator -= stepMilliseconds;
  }
  const snapshot = simulation.getSnapshot();
  updateSimulationView(
    snapshot,
    accumulator / stepMilliseconds,
    (currentSnapshot, interpolation) => city.update(currentSnapshot, interpolation),
    renderHud,
  );
  city.scene.render();
});
window.addEventListener('resize', () => engine.resize());
window.addEventListener('beforeunload', () => {
  city.dispose();
  engine.dispose();
});

setBuildOpen(false);
renderHud(initialSnapshot);
setSpeed(1);
registerSW({ immediate: true });
