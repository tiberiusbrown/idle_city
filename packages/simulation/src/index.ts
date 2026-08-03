import {
  createCitizenId,
  createGridPosition,
  stableHash,
  type CitizenId,
  type GridPosition,
} from '@idle-city/shared';

export type { CitizenId, GridPosition } from '@idle-city/shared';

export interface SimulationOptions {
  readonly seed?: number;
}

/** The authoritative order of work inside one logical tick. */
export const TICK_STAGE_ORDER = [
  'apply-queued-commands',
  'apply-zone-removals',
  'freeze-citizen-occupancy',
  'decrement-timers',
  'complete-expired-activities',
  'mark-citizens-requiring-goal',
  'fill-construction-assignments',
  'select-non-construction-goals',
  'advance-path-planning',
  'accrue-movement-credit',
  'generate-movement-proposals',
  'resolve-movement-conflicts',
  'commit-accepted-movement',
  'process-arrivals',
  'start-building-activities',
  'produce-workplace-data',
  'apply-construction-labor',
  'complete-buildings',
  'apply-assignment-changes',
  'evaluate-population-growth',
  'advance-building-planning',
  'commit-completed-tick',
] as const;

export type TickStage = (typeof TICK_STAGE_ORDER)[number];

export interface TickWorkResult {
  readonly status: 'in-progress' | 'committed';
  /** The last stage that consumed work in this call. */
  readonly stage: TickStage;
  readonly workUnitsConsumed: number;
}

export interface CitizenSnapshot {
  readonly id: CitizenId;
  readonly position: GridPosition;
  readonly previousPosition: GridPosition;
}

export interface SimulationSnapshot {
  readonly tick: number;
  readonly data: number;
  readonly population: number;
  readonly citizens: readonly CitizenSnapshot[];
  readonly zones: readonly never[];
  readonly buildings: readonly never[];
}

export interface Simulation {
  advanceTickWork(maxWorkUnits: number): TickWorkResult;
  getSnapshot(): SimulationSnapshot;
  getDeterminismHash(): string;
}

interface CitizenState {
  readonly id: CitizenId;
  readonly position: GridPosition;
  readonly previousPosition: GridPosition;
}

interface AuthoritativeState {
  readonly seed: number;
  readonly tick: number;
  readonly data: number;
  readonly citizens: readonly CitizenState[];
}

/**
 * Each stage owns a cursor even while its implementation is a no-op. Future
 * stages can extend their cursor without changing the transactional driver.
 */
interface StageCursor {
  workIndex: number;
}

interface TickCursors {
  readonly applyQueuedCommands: StageCursor;
  readonly applyZoneRemovals: StageCursor;
  readonly freezeCitizenOccupancy: StageCursor;
  readonly decrementTimers: StageCursor;
  readonly completeExpiredActivities: StageCursor;
  readonly markCitizensRequiringGoal: StageCursor;
  readonly fillConstructionAssignments: StageCursor;
  readonly selectNonConstructionGoals: StageCursor;
  readonly advancePathPlanning: StageCursor;
  readonly accrueMovementCredit: StageCursor;
  readonly generateMovementProposals: StageCursor;
  readonly resolveMovementConflicts: StageCursor;
  readonly commitAcceptedMovement: StageCursor;
  readonly processArrivals: StageCursor;
  readonly startBuildingActivities: StageCursor;
  readonly produceWorkplaceData: StageCursor;
  readonly applyConstructionLabor: StageCursor;
  readonly completeBuildings: StageCursor;
  readonly applyAssignmentChanges: StageCursor;
  readonly evaluatePopulationGrowth: StageCursor;
  readonly advanceBuildingPlanning: StageCursor;
  readonly commitCompletedTick: StageCursor;
}

interface PendingTick {
  readonly nextState: AuthoritativeState;
  readonly cursors: TickCursors;
  nextStageIndex: number;
}

const INITIAL_CITIZEN_POSITIONS: readonly GridPosition[] = [
  createGridPosition(0, 0),
  createGridPosition(1, 0),
  createGridPosition(0, 1),
  createGridPosition(1, 1),
];

function validateSeed(seed: number): number {
  if (!Number.isSafeInteger(seed)) {
    throw new Error(`Simulation seeds must be safe integers; received ${String(seed)}.`);
  }
  return seed;
}

function copyPosition(position: GridPosition): GridPosition {
  return createGridPosition(position.x, position.y);
}

function copySnapshotPosition(position: GridPosition): GridPosition {
  return { x: position.x, y: position.y };
}

function createInitialState(seed: number): AuthoritativeState {
  const citizens = INITIAL_CITIZEN_POSITIONS.map((position, index) => ({
    id: createCitizenId(`citizen-${index + 1}`),
    position,
    previousPosition: position,
  }));

  return Object.freeze({
    seed: validateSeed(seed),
    tick: 0,
    data: 10,
    citizens: Object.freeze(citizens),
  });
}

function createSnapshot(state: AuthoritativeState): SimulationSnapshot {
  return {
    tick: state.tick,
    data: state.data,
    population: state.citizens.length,
    citizens: state.citizens.map((citizen) => ({
      id: citizen.id,
      position: copySnapshotPosition(citizen.position),
      previousPosition: copySnapshotPosition(citizen.previousPosition),
    })),
    zones: [],
    buildings: [],
  };
}

function createTickCursor(): StageCursor {
  return { workIndex: 0 };
}

function createTickCursors(): TickCursors {
  return {
    applyQueuedCommands: createTickCursor(),
    applyZoneRemovals: createTickCursor(),
    freezeCitizenOccupancy: createTickCursor(),
    decrementTimers: createTickCursor(),
    completeExpiredActivities: createTickCursor(),
    markCitizensRequiringGoal: createTickCursor(),
    fillConstructionAssignments: createTickCursor(),
    selectNonConstructionGoals: createTickCursor(),
    advancePathPlanning: createTickCursor(),
    accrueMovementCredit: createTickCursor(),
    generateMovementProposals: createTickCursor(),
    resolveMovementConflicts: createTickCursor(),
    commitAcceptedMovement: createTickCursor(),
    processArrivals: createTickCursor(),
    startBuildingActivities: createTickCursor(),
    produceWorkplaceData: createTickCursor(),
    applyConstructionLabor: createTickCursor(),
    completeBuildings: createTickCursor(),
    applyAssignmentChanges: createTickCursor(),
    evaluatePopulationGrowth: createTickCursor(),
    advanceBuildingPlanning: createTickCursor(),
    commitCompletedTick: createTickCursor(),
  };
}

function createPendingTick(state: AuthoritativeState): PendingTick {
  const citizens = state.citizens.map((citizen) => ({
    id: citizen.id,
    position: copyPosition(citizen.position),
    previousPosition: copyPosition(citizen.position),
  }));

  return {
    nextState: {
      seed: state.seed,
      tick: state.tick + 1,
      data: state.data,
      citizens,
    },
    cursors: createTickCursors(),
    nextStageIndex: 0,
  };
}

function consumeStageCursor(cursor: StageCursor): void {
  if (cursor.workIndex !== 0) {
    throw new Error('A tick stage was processed more than once.');
  }
  cursor.workIndex = 1;
}

function processStage(pendingTick: PendingTick, stage: TickStage): void {
  switch (stage) {
    case 'apply-queued-commands':
      consumeStageCursor(pendingTick.cursors.applyQueuedCommands);
      return;
    case 'apply-zone-removals':
      consumeStageCursor(pendingTick.cursors.applyZoneRemovals);
      return;
    case 'freeze-citizen-occupancy':
      consumeStageCursor(pendingTick.cursors.freezeCitizenOccupancy);
      return;
    case 'decrement-timers':
      consumeStageCursor(pendingTick.cursors.decrementTimers);
      return;
    case 'complete-expired-activities':
      consumeStageCursor(pendingTick.cursors.completeExpiredActivities);
      return;
    case 'mark-citizens-requiring-goal':
      consumeStageCursor(pendingTick.cursors.markCitizensRequiringGoal);
      return;
    case 'fill-construction-assignments':
      consumeStageCursor(pendingTick.cursors.fillConstructionAssignments);
      return;
    case 'select-non-construction-goals':
      consumeStageCursor(pendingTick.cursors.selectNonConstructionGoals);
      return;
    case 'advance-path-planning':
      consumeStageCursor(pendingTick.cursors.advancePathPlanning);
      return;
    case 'accrue-movement-credit':
      consumeStageCursor(pendingTick.cursors.accrueMovementCredit);
      return;
    case 'generate-movement-proposals':
      consumeStageCursor(pendingTick.cursors.generateMovementProposals);
      return;
    case 'resolve-movement-conflicts':
      consumeStageCursor(pendingTick.cursors.resolveMovementConflicts);
      return;
    case 'commit-accepted-movement':
      consumeStageCursor(pendingTick.cursors.commitAcceptedMovement);
      return;
    case 'process-arrivals':
      consumeStageCursor(pendingTick.cursors.processArrivals);
      return;
    case 'start-building-activities':
      consumeStageCursor(pendingTick.cursors.startBuildingActivities);
      return;
    case 'produce-workplace-data':
      consumeStageCursor(pendingTick.cursors.produceWorkplaceData);
      return;
    case 'apply-construction-labor':
      consumeStageCursor(pendingTick.cursors.applyConstructionLabor);
      return;
    case 'complete-buildings':
      consumeStageCursor(pendingTick.cursors.completeBuildings);
      return;
    case 'apply-assignment-changes':
      consumeStageCursor(pendingTick.cursors.applyAssignmentChanges);
      return;
    case 'evaluate-population-growth':
      consumeStageCursor(pendingTick.cursors.evaluatePopulationGrowth);
      return;
    case 'advance-building-planning':
      consumeStageCursor(pendingTick.cursors.advanceBuildingPlanning);
      return;
    case 'commit-completed-tick':
      consumeStageCursor(pendingTick.cursors.commitCompletedTick);
      return;
  }
}

function validateWorkBudget(maxWorkUnits: number): void {
  if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits <= 0) {
    throw new Error(
      `maxWorkUnits must be a positive safe integer; received ${String(maxWorkUnits)}.`,
    );
  }
}

export function createSimulation(options: SimulationOptions = {}): Simulation {
  let committedState = createInitialState(options.seed ?? 0);
  let pendingTick: PendingTick | null = null;

  return {
    advanceTickWork(maxWorkUnits: number): TickWorkResult {
      validateWorkBudget(maxWorkUnits);

      const activeTick = pendingTick ?? createPendingTick(committedState);
      pendingTick = activeTick;

      let workUnitsConsumed = 0;
      let lastStage: TickStage | undefined;

      while (workUnitsConsumed < maxWorkUnits) {
        const stage = TICK_STAGE_ORDER[activeTick.nextStageIndex];
        if (stage === undefined) {
          throw new Error('Pending tick has no remaining stage.');
        }

        processStage(activeTick, stage);
        workUnitsConsumed += 1;
        lastStage = stage;

        if (stage === 'commit-completed-tick') {
          committedState = activeTick.nextState;
          pendingTick = null;
          return {
            status: 'committed',
            stage,
            workUnitsConsumed,
          };
        }

        activeTick.nextStageIndex += 1;
      }

      if (lastStage === undefined) {
        throw new Error('A valid work budget must consume at least one stage.');
      }

      return {
        status: 'in-progress',
        stage: lastStage,
        workUnitsConsumed,
      };
    },
    getSnapshot(): SimulationSnapshot {
      return createSnapshot(committedState);
    },
    getDeterminismHash(): string {
      return stableHash({
        seed: committedState.seed,
        tick: committedState.tick,
        data: committedState.data,
        citizens: committedState.citizens,
        zones: [],
        buildings: [],
      });
    },
  };
}
