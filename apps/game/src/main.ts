import { Engine } from '@babylonjs/core/Engines/engine';
import { createCityScene } from '@idle-city/renderer';
import {
  createSimulation,
  getBuildingArchetype,
  ZONE_DEFINITIONS,
  type PlaceZoneCommand,
  type PlaceZoneRejectionReason,
  type ZoneType,
} from '@idle-city/simulation';
import type { GridPosition } from '@idle-city/shared';
import { registerSW } from 'virtual:pwa-register';
import './style.css';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const dataValue = document.querySelector<HTMLElement>('#data-value');
const populationValue = document.querySelector<HTMLElement>('#population-value');
const homeCapacityValue = document.querySelector<HTMLElement>('#home-capacity-value');
const workCapacityValue = document.querySelector<HTMLElement>('#work-capacity-value');
const constructionWorkersValue = document.querySelector<HTMLElement>('#construction-workers-value');
const assignmentStatus = document.querySelector<HTMLElement>('#assignment-status');
const constructionStatus = document.querySelector<HTMLElement>('#construction-status');
const tickValue = document.querySelector<HTMLElement>('#tick-value');
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button');
const normalButton = document.querySelector<HTMLButtonElement>('#normal-button');
const fastButton = document.querySelector<HTMLButtonElement>('#fast-button');
const livingZoneButton = document.querySelector<HTMLButtonElement>('#living-zone-button');
const workingZoneButton = document.querySelector<HTMLButtonElement>('#working-zone-button');
const leisureZoneButton = document.querySelector<HTMLButtonElement>('#leisure-zone-button');
const cancelZoneButton = document.querySelector<HTMLButtonElement>('#cancel-zone-button');
const placementStatus = document.querySelector<HTMLElement>('#placement-status');
if (
  canvas === null ||
  dataValue === null ||
  populationValue === null ||
  homeCapacityValue === null ||
  workCapacityValue === null ||
  constructionWorkersValue === null ||
  assignmentStatus === null ||
  constructionStatus === null ||
  tickValue === null ||
  pauseButton === null ||
  normalButton === null ||
  fastButton === null ||
  livingZoneButton === null ||
  workingZoneButton === null ||
  leisureZoneButton === null ||
  cancelZoneButton === null ||
  placementStatus === null
) {
  throw new Error('The Idle City interface is missing required elements.');
}

const TARGET_TICKS_PER_SECOND = 5;
const FAST_SPEED_MULTIPLIER = 4;
const SIMULATION_WORK_BUDGET = 64;
const FRAME_WORK_ALLOWANCE_MS = 4;

type SimulationSpeed = 'paused' | 'normal' | 'fast';

const simulation = createSimulation();
const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true });
const city = createCityScene(engine, simulation.getSnapshot());

const zoneButtons: Record<ZoneType, HTMLButtonElement> = {
  living: livingZoneButton,
  working: workingZoneButton,
  leisure: leisureZoneButton,
};

const displayZoneType = (zoneType: ZoneType): string =>
  zoneType.charAt(0).toUpperCase() + zoneType.slice(1);

const isZoneType = (value: string | undefined): value is ZoneType =>
  value === 'living' || value === 'working' || value === 'leisure';

const rejectionMessage = (reason: PlaceZoneRejectionReason | undefined): string => {
  const messages: Record<PlaceZoneRejectionReason, string> = {
    'invalid-type': 'That zone type is not available.',
    'invalid-dimensions': 'That zone must use its fixed authoritative size.',
    'invalid-coordinates': 'Choose a safe integer grid location.',
    'invalid-cost': 'The placement cost is invalid; refresh the preview.',
    'stale-cost': 'The cost changed; refresh the preview and try again.',
    overlap: 'Zones may not overlap.',
    'insufficient-data': 'You do not have enough Data for that zone.',
  };
  return reason === undefined ? 'Placement rejected by the simulation.' : messages[reason];
};

let selectedZoneType: ZoneType | undefined;
let previewCell: GridPosition | undefined;
let pendingPlacementAtTick: number | undefined;

const setPlacementStatus = (
  message: string,
  state: 'neutral' | 'valid' | 'invalid' = 'neutral',
) => {
  placementStatus.textContent = message;
  placementStatus.classList.toggle('valid', state === 'valid');
  placementStatus.classList.toggle('invalid', state === 'invalid');
};

const setSelectedZoneType = (zoneType: ZoneType | undefined): void => {
  selectedZoneType = zoneType;
  for (const [buttonType, button] of Object.entries(zoneButtons)) {
    button.setAttribute('aria-pressed', String(buttonType === zoneType));
  }
  if (zoneType === undefined) {
    previewCell = undefined;
    city.setZonePlacementPreview(undefined);
    setPlacementStatus('Select a zone type, then click the grid to place it.');
    return;
  }
  setPlacementStatus(
    `${displayZoneType(zoneType)} selected. Move over the grid to preview its fixed footprint.`,
  );
  renderPlacementPreview(previewCell);
};

const commandForOrigin = (zoneType: ZoneType, origin: GridPosition): PlaceZoneCommand => {
  const definition = ZONE_DEFINITIONS[zoneType];
  const snapshot = simulation.getSnapshot();
  return {
    type: 'place-zone',
    zoneType,
    rect: {
      x: origin.x,
      y: origin.y,
      width: definition.width,
      height: definition.height,
    },
    expectedCost: snapshot.nextZoneCosts[zoneType],
  };
};

const renderPlacementPreview = (origin: GridPosition | undefined): void => {
  if (selectedZoneType === undefined || origin === undefined) {
    city.setZonePlacementPreview(undefined);
    return;
  }

  const command = commandForOrigin(selectedZoneType, origin);
  const preview = simulation.getZonePlacementPreview(command);
  city.setZonePlacementPreview({
    zoneType: selectedZoneType,
    rect: preview.rect,
    valid: preview.valid,
  });
  const originText = `(${String(origin.x)}, ${String(origin.y)})`;
  setPlacementStatus(
    preview.valid
      ? `Valid ${displayZoneType(selectedZoneType)} at ${originText}; click to place for ${String(preview.currentCost)} Data.`
      : `${rejectionMessage(preview.reason)} ${displayZoneType(selectedZoneType)} at ${originText}.`,
    preview.valid ? 'valid' : 'invalid',
  );
};

const queuePlacementAt = (origin: GridPosition): void => {
  if (selectedZoneType === undefined) return;
  const command = commandForOrigin(selectedZoneType, origin);
  const preview = simulation.getZonePlacementPreview(command);
  city.setZonePlacementPreview({
    zoneType: selectedZoneType,
    rect: preview.rect,
    valid: preview.valid,
  });
  const queuedAtTick = simulation.getSnapshot().tick;
  simulation.placeZone(command);
  pendingPlacementAtTick = queuedAtTick;
  setPlacementStatus(
    preview.valid
      ? `${displayZoneType(selectedZoneType)} placement submitted at (${String(origin.x)}, ${String(origin.y)}).`
      : `Placement submitted; ${rejectionMessage(preview.reason)}`,
    preview.valid ? 'neutral' : 'invalid',
  );
};

const updateHud = (snapshot: ReturnType<typeof simulation.getSnapshot>): void => {
  dataValue.textContent = String(snapshot.data);
  populationValue.textContent = String(snapshot.population);
  const completedBuildings = snapshot.buildings.filter(
    (building) => building.state.kind === 'complete',
  );
  const homeBuildings = completedBuildings.filter(
    (building) => getBuildingArchetype(building.archetypeId).capacities.residents > 0,
  );
  const workBuildings = completedBuildings.filter(
    (building) => getBuildingArchetype(building.archetypeId).capacities.workers > 0,
  );
  const homeCapacity = snapshot.completedHomeCapacity;
  const workCapacity = workBuildings.reduce(
    (capacity, building) =>
      capacity + getBuildingArchetype(building.archetypeId).capacities.workers,
    0,
  );
  const homeAssignments = homeBuildings.reduce(
    (count, building) => count + building.assignments.residentCitizenIds.length,
    0,
  );
  const workAssignments = workBuildings.reduce(
    (count, building) => count + building.assignments.workerCitizenIds.length,
    0,
  );
  homeCapacityValue.textContent = String(homeCapacity);
  workCapacityValue.textContent = String(workCapacity);
  assignmentStatus.textContent = `Home assignments: ${String(homeAssignments)}/${String(homeCapacity)} · Work assignments: ${String(workAssignments)}/${String(workCapacity)}`;
  const incompleteBuildings = snapshot.buildings.filter(
    (building) => building.state.kind === 'incomplete',
  );
  const constructionWorkerCount = incompleteBuildings.reduce(
    (count, building) => count + building.assignments.constructionWorkerIds.length,
    0,
  );
  constructionWorkersValue.textContent = String(constructionWorkerCount);
  constructionStatus.textContent =
    incompleteBuildings.length === 0
      ? 'No active construction.'
      : incompleteBuildings
          .map((building) => {
            if (building.state.kind !== 'incomplete') return '';
            const visualKind = getBuildingArchetype(building.archetypeId).visualKind;
            const name = visualKind === 'house' ? 'House' : visualKind === 'shop' ? 'Shop' : 'Park';
            const labor = `${String(building.state.laborCompleted)}/${String(building.state.laborRequired)} labor`;
            const workers = `${String(building.assignments.constructionWorkerIds.length)} worker${building.assignments.constructionWorkerIds.length === 1 ? '' : 's'}`;
            return `${name}: ${labor} · ${workers}`;
          })
          .join(' | ');
  tickValue.textContent = String(snapshot.tick);
  livingZoneButton.textContent = `Living - ${String(snapshot.nextZoneCosts.living)} Data`;
  workingZoneButton.textContent = `Working - ${String(snapshot.nextZoneCosts.working)} Data`;
  leisureZoneButton.textContent = `Leisure - ${String(snapshot.nextZoneCosts.leisure)} Data`;
};

const showCompletedCommandResult = (): void => {
  if (pendingPlacementAtTick === undefined) return;
  const queuedAtTick = pendingPlacementAtTick;
  const result = simulation
    .getLastCommandResults()
    .find((candidate) => candidate.tick > queuedAtTick);
  if (result === undefined) return;

  pendingPlacementAtTick = undefined;
  if (result.accepted) {
    city.setZonePlacementPreview(undefined);
    previewCell = undefined;
    setPlacementStatus(
      `${displayZoneType(result.zone.type)} zone placed for ${String(result.cost)} Data.`,
      'valid',
    );
    return;
  }
  setPlacementStatus(rejectionMessage(result.reason), 'invalid');
};

let speed: SimulationSpeed = 'normal';
let requestedTicks = 0;
let lastFrameTime: number | null = null;
let animationFrameId = 0;
let disposed = false;

const speedMultiplier = (value: SimulationSpeed): number => {
  if (value === 'fast') return FAST_SPEED_MULTIPLIER;
  if (value === 'normal') return 1;
  return 0;
};

const updateSpeedControls = (): void => {
  pauseButton.setAttribute('aria-pressed', String(speed === 'paused'));
  normalButton.setAttribute('aria-pressed', String(speed === 'normal'));
  fastButton.setAttribute('aria-pressed', String(speed === 'fast'));
};

const setSpeed = (nextSpeed: SimulationSpeed): void => {
  speed = nextSpeed;
  updateSpeedControls();
};

pauseButton.addEventListener('click', () => setSpeed('paused'));
normalButton.addEventListener('click', () => setSpeed('normal'));
fastButton.addEventListener('click', () => setSpeed('fast'));
updateSpeedControls();

for (const button of Object.values(zoneButtons)) {
  const zoneType = button.dataset.zoneType;
  if (!isZoneType(zoneType)) throw new Error('A zone button has an invalid zone type.');
  button.addEventListener('click', () => setSelectedZoneType(zoneType));
}
cancelZoneButton.addEventListener('click', () => setSelectedZoneType(undefined));

canvas.addEventListener('pointermove', (event) => {
  if (selectedZoneType === undefined) return;
  previewCell = city.pickLogicalCell(event.clientX, event.clientY);
  renderPlacementPreview(previewCell);
});
canvas.addEventListener('pointerleave', () => {
  if (selectedZoneType === undefined) return;
  previewCell = undefined;
  city.setZonePlacementPreview(undefined);
  setPlacementStatus(
    `${displayZoneType(selectedZoneType)} selected. Move over the grid to preview its fixed footprint.`,
  );
});
canvas.addEventListener('click', (event) => {
  if (selectedZoneType === undefined) return;
  const pickedCell = city.pickLogicalCell(event.clientX, event.clientY);
  if (pickedCell === undefined) {
    setPlacementStatus('Choose a visible cell on the logical grid.', 'invalid');
    return;
  }
  previewCell = pickedCell;
  queuePlacementAt(pickedCell);
});

const resize = (): void => city.resize();
window.addEventListener('resize', resize);

const advanceSimulationForFrame = (elapsedSeconds: number): void => {
  const multiplier = speedMultiplier(speed);
  if (multiplier === 0) return;

  requestedTicks += elapsedSeconds * TARGET_TICKS_PER_SECOND * multiplier;
  const frameDeadline = performance.now() + FRAME_WORK_ALLOWANCE_MS;

  while (requestedTicks >= 1 && performance.now() < frameDeadline) {
    const result = simulation.advanceTickWork(SIMULATION_WORK_BUDGET);
    if (result.status === 'committed') requestedTicks -= 1;
  }
};

const renderFrame = (frameTime: number): void => {
  if (disposed) return;

  const elapsedSeconds =
    lastFrameTime === null ? 0 : Math.min(0.25, Math.max(0, (frameTime - lastFrameTime) / 1_000));
  lastFrameTime = frameTime;

  advanceSimulationForFrame(elapsedSeconds);

  const snapshot = simulation.getSnapshot();
  const interpolationAlpha = Math.min(1, Math.max(0, requestedTicks));
  city.update(snapshot, interpolationAlpha);
  updateHud(snapshot);
  showCompletedCommandResult();
  city.scene.render();

  animationFrameId = window.requestAnimationFrame(renderFrame);
};

updateHud(simulation.getSnapshot());
setSelectedZoneType(undefined);
animationFrameId = window.requestAnimationFrame(renderFrame);

window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true;
  window.cancelAnimationFrame(animationFrameId);
  window.removeEventListener('resize', resize);
  city.dispose();
  engine.dispose();
});

registerSW({ immediate: true });
