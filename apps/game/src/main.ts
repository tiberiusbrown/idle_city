import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene, type PickedLogicalCell } from '@idle-city/renderer';
import {
  createSimulation,
  type CommandRejectionReason,
  type DistrictSeedPlacementInfo,
  type DistrictSeedKind,
  type ResearchFocus,
  type SimulationSnapshot,
} from '@idle-city/simulation';
import { registerSW } from 'virtual:pwa-register';
import './style.css';
import { updateSimulationView } from './view-update';

type PlaceableDistrictSeedKind = Extract<DistrictSeedKind, 'living' | 'working' | 'services'>;

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
const researchButton = document.querySelector<HTMLButtonElement>('[data-action="research"]');
const researchPanel = document.querySelector<HTMLElement>('[data-testid="research-panel"]');
const coreStatusElement = document.querySelector<HTMLElement>('[data-testid="core-status"]');
const coreCostElement = document.querySelector<HTMLElement>('[data-testid="core-cost"]');
const coreRequirementsElement = document.querySelector<HTMLElement>(
  '[data-testid="core-requirements"]',
);
const confirmCoreButton = document.querySelector<HTMLButtonElement>('[data-action="confirm-core"]');
const placementStatusElement = document.querySelector<HTMLElement>(
  '[data-testid="placement-status"]',
);
const placementCostElement = document.querySelector<HTMLElement>('[data-testid="placement-cost"]');
const placementRadiusElement = document.querySelector<HTMLElement>(
  '[data-testid="placement-radius"]',
);
const placementCoordinatesElement = document.querySelector<HTMLElement>(
  '[data-testid="placement-coordinates"]',
);
const activeCoveredCountElement = document.querySelector<HTMLElement>(
  '[data-testid="active-covered-count"]',
);
const placementReasonElement = document.querySelector<HTMLElement>(
  '[data-testid="placement-reason"]',
);
const buildDataElement = document.querySelector<HTMLElement>('[data-testid="build-data"]');
const confirmPlacementButton = document.querySelector<HTMLButtonElement>(
  '[data-action="confirm-placement"]',
);
const cancelPlacementButton = document.querySelector<HTMLButtonElement>(
  '[data-action="cancel-placement"]',
);
const livingCostElement = document.querySelector<HTMLElement>('[data-testid="living-cost"]');
const workingCostElement = document.querySelector<HTMLElement>('[data-testid="working-cost"]');
const servicesCostElement = document.querySelector<HTMLElement>('[data-testid="services-cost"]');
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
  researchButton === null ||
  researchPanel === null ||
  coreStatusElement === null ||
  coreCostElement === null ||
  coreRequirementsElement === null ||
  confirmCoreButton === null ||
  placementStatusElement === null ||
  placementCostElement === null ||
  placementRadiusElement === null ||
  placementCoordinatesElement === null ||
  activeCoveredCountElement === null ||
  placementReasonElement === null ||
  buildDataElement === null ||
  confirmPlacementButton === null ||
  cancelPlacementButton === null ||
  livingCostElement === null ||
  workingCostElement === null ||
  servicesCostElement === null ||
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
const researchToggle = researchButton;
const researchMenu = researchPanel;
const coreStatusDisplay = coreStatusElement;
const coreCostDisplay = coreCostElement;
const coreRequirementsDisplay = coreRequirementsElement;
const confirmCorePurchaseButton = confirmCoreButton;
const placementStatusDisplay = placementStatusElement;
const placementCostDisplay = placementCostElement;
const placementRadiusDisplay = placementRadiusElement;
const placementCoordinatesDisplay = placementCoordinatesElement;
const activeCoveredCountDisplay = activeCoveredCountElement;
const placementReasonDisplay = placementReasonElement;
const buildDataDisplay = buildDataElement;
const confirmButton = confirmPlacementButton;
const livingCostDisplay = livingCostElement;
const workingCostDisplay = workingCostElement;
const servicesCostDisplay = servicesCostElement;
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
let researchOpen = false;
let placementKind: PlaceableDistrictSeedKind | undefined;
let placementCandidate: DistrictSeedPlacementInfo | undefined;
let placementLocked = false;
let researchFocus: ResearchFocus | undefined;
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
  return value === 'living' || value === 'working' || value === 'services';
}

function formatData(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function displayKind(kind: DistrictSeedKind): string {
  return kind === 'living' ? 'Living' : kind === 'working' ? 'Working' : 'Services';
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
    case 'right-of-way':
      return 'That cell is protected public right-of-way.';
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
  placementCandidate = undefined;
  placementLocked = false;
  city.setPlacementPreview(undefined);
  city.setSeedInfluenceVisibility({});
  buildKindButtons.forEach((button) => button.setAttribute('aria-pressed', 'false'));
  cancelButton.hidden = true;
  confirmButton.hidden = true;
  confirmButton.disabled = true;
  confirmButton.textContent = 'Place district seed';
  placementCostDisplay.textContent = 'Select a district to see its cost.';
  placementRadiusDisplay.textContent = '—';
  placementCoordinatesDisplay.textContent = '—';
  activeCoveredCountDisplay.textContent = '—';
  placementReasonDisplay.textContent = '—';
  setPlacementStatus(
    simulation.getServicesCoreState().unlocked
      ? 'Choose Living, Working, or Services to enter placement mode.'
      : 'Choose Living or Working to enter placement mode.',
  );
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

function coreRejectionMessage(reason: string): string {
  switch (reason) {
    case 'invalid-focus':
      return 'Choose one research focus before installing the Core.';
    case 'already-purchased':
      return 'Services Core is already installed.';
    case 'missing-prerequisites':
      return 'The city has not met every Services Core requirement.';
    case 'insufficient-data':
      return 'Not enough Data to install Services Core.';
    default:
      return 'Services Core cannot be installed yet.';
  }
}

function displayResearchFocus(focus: ResearchFocus | null | undefined): string {
  if (focus === 'space') return 'Space';
  if (focus === 'access') return 'Access';
  if (focus === 'activity') return 'Activity';
  return 'None';
}

function setResearchOpen(open: boolean): void {
  researchOpen = open;
  researchMenu.hidden = !open;
  researchToggle.setAttribute('aria-expanded', String(open));
  researchToggle.setAttribute('aria-label', open ? 'Close Research menu' : 'Open Research menu');
  researchToggle.classList.toggle('active', open);
  if (open) renderResearch(simulation.getSnapshot());
}

function renderResearch(snapshot: SimulationSnapshot): void {
  const core = snapshot.servicesCore;
  coreCostDisplay.textContent = `${String(core.cost)} Data`;
  coreRequirementsDisplay.textContent = core.requirements
    .map(
      (requirement) =>
        `${requirement.label}: ${String(Math.min(requirement.current, requirement.required))}/${String(requirement.required)}${requirement.met ? ' ✓' : ' — missing'}`,
    )
    .join(' · ');
  const focusButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-research-focus]')];
  focusButtons.forEach((button) => {
    const focus = button.dataset.researchFocus;
    const selected = focus === researchFocus;
    button.setAttribute('aria-pressed', String(selected));
    button.disabled = core.purchased;
  });
  if (core.purchased) {
    coreStatusDisplay.textContent = `Installed — ${displayResearchFocus(core.focus)} focus`;
    confirmCorePurchaseButton.disabled = true;
    confirmCorePurchaseButton.textContent = 'Services Core installed';
    return;
  }
  const info = simulation.getCorePurchaseInfo('services');
  coreStatusDisplay.textContent =
    info.missingRequirements.length > 0
      ? 'Needs prerequisites'
      : snapshot.data < core.cost
        ? 'Requirements met — earn more Data'
        : 'Ready when a focus is selected';
  confirmCorePurchaseButton.disabled = !info.eligible || researchFocus === undefined;
  confirmCorePurchaseButton.textContent =
    researchFocus === undefined
      ? 'Choose a focus to install Services Core'
      : `Install Services Core — ${displayResearchFocus(researchFocus)} focus`;
}

function beginPlacement(kind: PlaceableDistrictSeedKind): void {
  if (!simulation.getDistrictSeedDefinition(kind).unlocked) {
    statusDisplay.textContent = 'Services is locked until Services Core is installed.';
    return;
  }
  setBuildOpen(true);
  clearPrimaryPointerGesture();
  placementCandidate = undefined;
  placementLocked = false;
  city.setPlacementPreview(undefined);
  city.setSeedInfluenceVisibility({ placing: true });
  placementKind = kind;
  const definition = simulation.getDistrictSeedDefinition(kind);
  const cost = simulation.getCurrentDistrictSeedCost(kind);
  buildKindButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.buildKind === kind));
  });
  cancelButton.hidden = false;
  confirmButton.hidden = true;
  confirmButton.disabled = true;
  placementCostDisplay.textContent = `Current cost: ${String(cost)} Data`;
  placementRadiusDisplay.textContent = `${String(definition.influenceRadius)} cells`;
  placementCoordinatesDisplay.textContent = '—';
  activeCoveredCountDisplay.textContent = '—';
  placementReasonDisplay.textContent = 'Hover over a cell to preview.';
  setPlacementStatus(`${displayKind(kind)} placement mode: move over an active visible cell.`);
  gameCanvas.setAttribute(
    'aria-label',
    `${displayKind(kind)} placement mode. Choose a cell in an active visible chunk.`,
  );
}

function renderPlacementInfo(info: DistrictSeedPlacementInfo, locked: boolean): void {
  const coordinates = `(${String(info.position.x)}, ${String(info.position.y)})`;
  placementCandidate = info;
  city.setPlacementPreview(info);
  placementRadiusDisplay.textContent = `${String(info.radius)} cells`;
  placementCoordinatesDisplay.textContent = coordinates;
  activeCoveredCountDisplay.textContent = `${String(info.activeCoveredCellCount)} / ${String(info.coveredCellCount)} cells`;
  placementReasonDisplay.textContent = info.valid
    ? locked
      ? 'Ready to confirm.'
      : 'Valid candidate.'
    : rejectionMessage(info.reason ?? 'invalid-kind');
  placementCostDisplay.textContent = `Current cost: ${String(info.cost)} Data`;
  confirmButton.textContent = `Place ${displayKind(info.kind)} for ${String(info.cost)} Data`;
  confirmButton.setAttribute('aria-label', confirmButton.textContent);
  confirmButton.hidden = !locked;
  confirmButton.disabled = !locked || !info.valid;
  const state = info.valid ? 'valid' : 'invalid';
  setPlacementStatus(
    info.valid
      ? `${locked ? 'Selected' : 'Valid'} ${displayKind(info.kind)} placement at ${coordinates}.`
      : `${rejectionMessage(info.reason ?? 'invalid-kind')} Cell ${coordinates}.`,
    state,
  );
}

function previewPlacementAt(picked: PickedLogicalCell | undefined): void {
  if (placementKind === undefined) return;
  if (placementLocked) return;
  if (picked === undefined) {
    placementCandidate = undefined;
    city.setPlacementPreview(undefined);
    placementRadiusDisplay.textContent = `${String(simulation.getDistrictSeedDefinition(placementKind).influenceRadius)} cells`;
    placementCoordinatesDisplay.textContent = '—';
    activeCoveredCountDisplay.textContent = '—';
    placementReasonDisplay.textContent = 'Hover over a cell to preview.';
    confirmButton.hidden = true;
    confirmButton.disabled = true;
    setPlacementStatus('Move over an active visible chunk to preview placement.');
    return;
  }
  const preview = simulation.getDistrictSeedPlacementInfo({
    kind: placementKind,
    position: picked.position,
  });
  renderPlacementInfo(preview, false);
}

function updatePlacementAt(clientX: number, clientY: number): void {
  if (placementKind === undefined) return;
  previewPlacementAt(city.pickLogicalCell(clientX, clientY));
}

function lockPlacement(event: PointerEvent): void {
  if (placementKind === undefined) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  const picked = city.pickLogicalCell(event.clientX, event.clientY);
  if (picked === undefined) {
    setPlacementStatus('Choose a cell in an active visible chunk.', 'invalid');
    return;
  }
  const info = simulation.getDistrictSeedPlacementInfo({
    kind: placementKind,
    position: picked.position,
  });
  placementLocked = true;
  renderPlacementInfo(info, true);
  statusDisplay.textContent = info.valid
    ? 'Candidate locked. Confirm to spend Data.'
    : `Candidate locked but invalid: ${rejectionMessage(info.reason ?? 'invalid-kind')}`;
}

function confirmPlacement(): void {
  if (placementKind === undefined || !placementLocked || placementCandidate === undefined) return;
  const candidate = placementCandidate;
  const result = simulation.placeDistrictSeed({
    kind: placementKind,
    position: candidate.position,
  });
  const coordinates = `(${String(candidate.position.x)}, ${String(candidate.position.y)})`;
  if (!result.accepted) {
    const refreshed = simulation.getDistrictSeedPlacementInfo({
      kind: placementKind,
      position: candidate.position,
    });
    placementLocked = true;
    renderPlacementInfo(refreshed, true);
    statusDisplay.textContent = `${displayKind(placementKind)} placement rejected: ${rejectionMessage(result.reason)}`;
  } else {
    statusDisplay.textContent = `${displayKind(placementKind)} seed accepted at ${coordinates}; spent ${String(result.cost)} Data.`;
    placementCandidate = undefined;
    placementLocked = false;
    city.setPlacementPreview(undefined);
    confirmButton.hidden = true;
    confirmButton.disabled = true;
    placementCoordinatesDisplay.textContent = '—';
    activeCoveredCountDisplay.textContent = '—';
    placementReasonDisplay.textContent = 'Choose another cell to preview.';
    setPlacementStatus(
      `${displayKind(placementKind)} seed placed at ${coordinates}. Choose another cell or cancel.`,
      'valid',
    );
  }
  const snapshot = simulation.getSnapshot();
  updateSimulationView(
    snapshot,
    1,
    (currentSnapshot, interpolation) => city.update(currentSnapshot, interpolation),
    renderHud,
  );
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
  servicesCostDisplay.textContent = `${String(simulation.getCurrentDistrictSeedCost('services'))} Data`;
  const servicesBuildButton = buildKindButtons.find(
    (button) => button.dataset.buildKind === 'services',
  );
  if (servicesBuildButton !== undefined) {
    servicesBuildButton.hidden = !snapshot.servicesCore.unlocked;
  }
  buildDataDisplay.textContent = `Data available: ${formatData(snapshot.data)}`;
  if (placementKind !== undefined) {
    placementCostDisplay.textContent = `Current cost: ${String(simulation.getCurrentDistrictSeedCost(placementKind))} Data`;
  }
  if (researchOpen) renderResearch(snapshot);
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
    statusDisplay.textContent = simulation.getServicesCoreState().unlocked
      ? 'Build menu open. Choose Living, Working, or Services.'
      : 'Build menu open. Choose Living or Working.';
  }
});

researchToggle.addEventListener('click', () => {
  setResearchOpen(!researchOpen);
  statusDisplay.textContent = researchOpen ? 'Research menu open.' : 'Research menu closed.';
});

buildKindButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const kind = button.dataset.buildKind;
    if (!isPlaceableDistrictSeedKind(kind)) return;
    beginPlacement(kind);
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-research-focus]').forEach((button) => {
  button.addEventListener('click', () => {
    const focus = button.dataset.researchFocus;
    if (focus !== 'space' && focus !== 'access' && focus !== 'activity') return;
    researchFocus = focus;
    renderResearch(simulation.getSnapshot());
  });
});

confirmCorePurchaseButton.addEventListener('click', () => {
  if (researchFocus === undefined) {
    statusDisplay.textContent = 'Choose Space, Access, or Activity before confirming.';
    return;
  }
  const result = simulation.purchaseCore({ core: 'services', focus: researchFocus });
  if (!result.accepted) {
    statusDisplay.textContent = coreRejectionMessage(result.reason);
  } else {
    statusDisplay.textContent = `Services Core installed with ${displayResearchFocus(result.focus)} focus.`;
    researchFocus = undefined;
  }
  const snapshot = simulation.getSnapshot();
  updateSimulationView(
    snapshot,
    1,
    (currentSnapshot, interpolation) => city.update(currentSnapshot, interpolation),
    renderHud,
  );
});

cancelButton.addEventListener('click', () => {
  clearPlacementSelection();
  statusDisplay.textContent = 'Placement canceled.';
});

confirmButton.addEventListener('click', () => {
  confirmPlacement();
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
  lockPlacement(event);
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
  researchFocus = undefined;
  setBuildOpen(false);
  setResearchOpen(false);
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
setResearchOpen(false);
renderHud(initialSnapshot);
setSpeed(1);
registerSW({ immediate: true });
