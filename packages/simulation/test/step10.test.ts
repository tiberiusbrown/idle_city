import { describe, expect, it } from 'vitest';
import {
  BUILDING_FOOTPRINTS,
  calculateCityDemand,
  calculateServicesDemand,
  compareServiceDestinations,
  createSimulation,
  DISTRICT_SEED_COSTS,
  isInsideFootprint,
  scoreServiceDestination,
  selectServiceDestination,
  SERVICE_BUILDING_CAPACITY,
  SERVICE_DESTINATION_MAX_ROUTE_LENGTH,
  SERVICE_NEED_MAX,
  SERVICE_USE_DURATION_TICKS,
  SERVICES_CORE_COST,
  SERVICES_LOCAL_CAPACITY_RADIUS,
  type Building,
  type DistrictSeedKind,
  type ServiceDestinationCandidate,
  type Simulation,
  type SimulationConfig,
} from '../src/index';

const coreConfiguration: SimulationConfig = {
  chunkSize: 8,
  initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
  homePosition: { x: 0, y: 0 },
  workplacePosition: { x: 8, y: 8 },
  citizenCount: 20,
  housingCapacity: 20,
  workplaceCapacity: 20,
  populationCap: 20,
  activityDurationTicks: 1,
  startingData: 400,
  developmentEvaluationIntervalTicks: 100,
  seed: 10,
};

function firstValidSeedPosition(
  simulation: Simulation,
  kind: DistrictSeedKind,
  startX = 0,
  startY = 0,
): { readonly x: number; readonly y: number } {
  for (let y = startY; y < 48; y += 1) {
    for (let x = startX; x < 48; x += 1) {
      const preview = simulation.getDistrictSeedPlacementInfo({ kind, position: { x, y } });
      if (preview.valid) return { x, y };
    }
  }
  throw new Error(`No valid ${kind} seed position was found.`);
}

function placeFirstValidSeed(simulation: Simulation, kind: DistrictSeedKind): void {
  const position = firstValidSeedPosition(simulation, kind);
  expect(simulation.placeDistrictSeed({ kind, position }).accepted).toBe(true);
}

function createCoreProgression(
  developmentEvaluationIntervalTicks = coreConfiguration.developmentEvaluationIntervalTicks,
): Simulation {
  const simulation = createSimulation({
    ...coreConfiguration,
    developmentEvaluationIntervalTicks,
  });
  placeFirstValidSeed(simulation, 'living');
  placeFirstValidSeed(simulation, 'working');
  for (let tick = 0; tick < 1_500; tick += 1) {
    if (simulation.getSnapshot().completedWorkActivities >= 40) return simulation;
    simulation.step();
  }
  throw new Error('The Services Core work-activity requirement was not reached.');
}

function installServicesCore(
  simulation: Simulation,
  focus: 'space' | 'access' | 'activity' = 'activity',
): void {
  const result = simulation.purchaseCore({ core: 'services', focus });
  expect(result).toEqual({ accepted: true, core: 'services', focus, cost: SERVICES_CORE_COST });
}

function serviceBuilding(simulation: Simulation) {
  return simulation.getSnapshot().buildings.find((building) => building.type === 'service');
}

describe('Step 10 Services Core and vertical slice', () => {
  it('reports each Core prerequisite, accepts at the boundary, charges once, and detaches focus state', () => {
    const locked = createSimulation({ citizenCount: 20, startingData: 100 });
    expect(locked.getCorePurchaseInfo()).toMatchObject({
      eligible: false,
      missingRequirements: ['living-seed', 'working-seed', 'completed-work-activities'],
    });
    placeFirstValidSeed(locked, 'living');
    expect(locked.getCorePurchaseInfo().missingRequirements).toEqual([
      'working-seed',
      'completed-work-activities',
    ]);
    placeFirstValidSeed(locked, 'working');
    expect(locked.getCorePurchaseInfo().missingRequirements).toEqual(['completed-work-activities']);

    const simulation = createCoreProgression();
    const beforePurchase = simulation.getSnapshot();
    expect(beforePurchase.citizens).toHaveLength(20);
    expect(beforePurchase.completedWorkActivities).toBeGreaterThanOrEqual(40);
    expect(beforePurchase.servicesCore.requirements.every(({ met }) => met)).toBe(true);
    expect(simulation.getCorePurchaseInfo().eligible).toBe(true);

    const hashBefore = simulation.getDeterminismHash();
    const purchase = simulation.purchaseServicesCore({ focus: 'space' });
    expect(purchase).toEqual({
      accepted: true,
      core: 'services',
      focus: 'space',
      cost: SERVICES_CORE_COST,
    });
    const afterPurchase = simulation.getSnapshot();
    expect(afterPurchase.data).toBe(beforePurchase.data - SERVICES_CORE_COST);
    expect(afterPurchase.servicesCore).toMatchObject({
      purchased: true,
      unlocked: true,
      focus: 'space',
      selectedFocus: 'space',
    });
    expect(simulation.getDeterminismHash()).not.toBe(hashBefore);

    const detached = afterPurchase.servicesCore;
    (detached.requirements as { current: number }[])[0].current = 999;
    (detached.missingRequirements as string[]).push('population');
    expect(simulation.getServicesCoreState().requirements[0]?.current).not.toBe(999);
    expect(simulation.getServicesCoreState().missingRequirements).toEqual([]);

    const rejectionBefore = simulation.getSnapshot();
    const rejectionHash = simulation.getDeterminismHash();
    expect(simulation.purchaseCore({ focus: 'activity' })).toEqual({
      accepted: false,
      reason: 'already-purchased',
    });
    expect(simulation.getSnapshot()).toEqual(rejectionBefore);
    expect(simulation.getDeterminismHash()).toBe(rejectionHash);
  }, 30_000);

  it('keeps Services locked, then exposes the exact radius and price sequence after Core', () => {
    const locked = createSimulation({ citizenCount: 0, startingData: 100 });
    const lockedBefore = locked.getSnapshot();
    const lockedHash = locked.getDeterminismHash();
    expect(locked.getDistrictSeedDefinition('services')).toMatchObject({
      baseCost: DISTRICT_SEED_COSTS.services,
      influenceRadius: 8,
      sideLength: 17,
      unlocked: false,
    });
    expect(locked.previewDistrictSeed({ kind: 'services', position: { x: 6, y: 6 } })).toEqual({
      valid: false,
      reason: 'locked',
    });
    expect(locked.placeDistrictSeed({ kind: 'services', position: { x: 6, y: 6 } })).toEqual({
      accepted: false,
      reason: 'locked',
    });
    expect(locked.getSnapshot()).toEqual(lockedBefore);
    expect(locked.getDeterminismHash()).toBe(lockedHash);

    const simulation = createCoreProgression();
    installServicesCore(simulation);
    expect(simulation.getDistrictSeedDefinition('services').unlocked).toBe(true);
    expect(simulation.getCurrentDistrictSeedCost('services')).toBe(20);

    for (const expectedCost of [20, 25, 32, 40]) {
      expect(simulation.getCurrentDistrictSeedCost('services')).toBe(expectedCost);
      const position = firstValidSeedPosition(simulation, 'services');
      const preview = simulation.previewDistrictSeed({ kind: 'services', position });
      expect(preview).toEqual({ valid: true, cost: expectedCost });
      expect(simulation.placeDistrictSeed({ kind: 'services', position })).toMatchObject({
        accepted: true,
        cost: expectedCost,
      });
    }
  }, 30_000);

  it('uses deterministic six-decimal destination scores, reasons, and tie ordering', () => {
    const score = scoreServiceDestination({
      serviceNeed: 3,
      routeLength: 5,
      occupancyRatio: 0.25,
    });
    expect(score).toMatchObject({
      needValue: 0.75,
      availableQuality: 0.75,
      routeCost: 0.078125,
      expectedWait: 0.25,
      score: 0.484375,
      primaryReason: 'Service need is high.',
    });
    expect(
      scoreServiceDestination({ serviceNeed: 3, routeLength: 5, occupancyRatio: 0.25 }),
    ).toEqual(score);
    expect(SERVICE_DESTINATION_MAX_ROUTE_LENGTH).toBe(64);

    const building = (id: string): Building => ({
      id,
      type: 'service',
      footprint: { x: 2, y: 2, width: 4, height: 4 },
      entrance: { x: 2, y: 1 },
      capacity: SERVICE_BUILDING_CAPACITY,
    });
    const candidate = (
      id: string,
      routeLength: number,
      occupancyRatio: number,
    ): ServiceDestinationCandidate => ({
      building: building(id) as Building & { readonly type: 'service' },
      routeLength,
      occupancyRatio,
      score: 0.5,
      primaryReason: 'A compatible service destination is available.',
    });
    const tied = [candidate('service-2', 4, 0.25), candidate('service-1', 4, 0.25)];
    const firstTied = tied[0];
    const secondTied = tied[1];
    if (firstTied === undefined || secondTied === undefined) {
      throw new Error('Tied service candidates are required.');
    }
    expect(selectServiceDestination(tied)?.building.id).toBe('service-1');
    expect(compareServiceDestinations(firstTied, secondTied)).toBeGreaterThan(0);
    expect(
      selectServiceDestination([candidate('service-2', 3, 0.25), candidate('service-1', 4, 0.1)])
        ?.building.id,
    ).toBe('service-2');
  });

  it('constructs a 4x4 capacity-eight service building through citizen labor', () => {
    const simulation = createCoreProgression();
    installServicesCore(simulation);
    const serviceSeedPosition = firstValidSeedPosition(simulation, 'services');
    expect(
      simulation.placeDistrictSeed({ kind: 'services', position: serviceSeedPosition }).accepted,
    ).toBe(true);

    let observedProject = false;
    for (let tick = 0; tick < 450; tick += 1) {
      simulation.step();
      const project = simulation
        .getSnapshot()
        .constructionProjects.find(({ buildingType }) => buildingType === 'service');
      if (project === undefined) continue;
      observedProject = true;
      expect(project.footprint.width).toBe(BUILDING_FOOTPRINTS.service.width);
      expect(project.footprint.height).toBe(BUILDING_FOOTPRINTS.service.height);
      expect(project.capacity).toBe(SERVICE_BUILDING_CAPACITY);
      expect(project.stagingCells).toHaveLength(3);
      expect(project.connector.length).toBeGreaterThanOrEqual(4);
      expect(
        project.stagingCells.every((cell) => !isInsideFootprint(cell, project.footprint)),
      ).toBe(true);
      if (serviceBuilding(simulation) !== undefined) break;
    }
    expect(observedProject).toBe(true);
    const building = serviceBuilding(simulation);
    expect(building).toMatchObject({
      type: 'service',
      capacity: SERVICE_BUILDING_CAPACITY,
      footprint: { width: 4, height: 4 },
    });
  }, 30_000);

  it('increments and caps need, returns home before service, preserves unmet need, and uses exactly two ticks', () => {
    const simulation = createCoreProgression();
    installServicesCore(simulation);
    const serviceSeedPosition = firstValidSeedPosition(simulation, 'services');
    expect(
      simulation.placeDistrictSeed({ kind: 'services', position: serviceSeedPosition }).accepted,
    ).toBe(true);

    const activityHistory = new Map<string, string[]>();
    const serviceStart = new Map<string, { readonly tick: number; readonly need: number }>();
    let observedServiceCompletion = false;
    let maxNeed = 0;
    for (let tick = 0; tick < 1_100; tick += 1) {
      const before = simulation.getSnapshot();
      simulation.step();
      const current = simulation.getSnapshot();
      for (const citizen of current.citizens) {
        maxNeed = Math.max(maxNeed, citizen.serviceNeed);
        const history = activityHistory.get(citizen.id) ?? [];
        if (history.at(-1) !== citizen.activity) history.push(citizen.activity);
        activityHistory.set(citizen.id, history);
        const previous = before.citizens.find(({ id }) => id === citizen.id);
        if (previous?.activity !== 'service' && citizen.activity === 'service') {
          serviceStart.set(citizen.id, { tick: current.tick, need: citizen.serviceNeed });
        }
        const started = serviceStart.get(citizen.id);
        if (
          started !== undefined &&
          previous?.activity === 'service' &&
          citizen.activity !== 'service'
        ) {
          expect(current.tick - started.tick).toBe(SERVICE_USE_DURATION_TICKS);
          expect(citizen.serviceNeed).toBe(started.need - 2);
          expect(current.serviceUses).toBeGreaterThan(before.serviceUses);
          expect(current.dataGeneratedThisTickBySource.service).toBeGreaterThan(0);
          serviceStart.delete(citizen.id);
          observedServiceCompletion = true;
        }
      }
      const serviceOccupancy = current.citizens.filter(
        ({ serviceDestinationBuildingId }) => serviceDestinationBuildingId !== null,
      ).length;
      expect(serviceOccupancy).toBeLessThanOrEqual(SERVICE_BUILDING_CAPACITY);
      expect(
        current.citizens.every(
          ({ serviceNeed }) => serviceNeed >= 0 && serviceNeed <= SERVICE_NEED_MAX,
        ),
      ).toBe(true);
      if (observedServiceCompletion && current.serviceUses >= 2) break;
    }
    expect(maxNeed).toBeGreaterThanOrEqual(2);
    expect(observedServiceCompletion).toBe(true);
    expect(
      [...activityHistory.values()].some((history) => {
        const workIndex = history.indexOf('work');
        const commuteHomeIndex = history.indexOf('commuting-home', workIndex + 1);
        const homeIndex = history.indexOf('home', commuteHomeIndex + 1);
        const serviceIndex = history.indexOf('commuting-to-service', homeIndex + 1);
        return (
          workIndex >= 0 &&
          commuteHomeIndex > workIndex &&
          homeIndex > commuteHomeIndex &&
          serviceIndex > homeIndex
        );
      }),
    ).toBe(true);

    const noDestination = createCoreProgression(1_000);
    installServicesCore(noDestination);
    let noDestinationMaxNeed = 0;
    for (let tick = 0; tick < 260; tick += 1) {
      noDestination.step();
      noDestinationMaxNeed = Math.max(
        noDestinationMaxNeed,
        ...noDestination.getSnapshot().citizens.map(({ serviceNeed }) => serviceNeed),
      );
    }
    const noServiceSnapshot = noDestination.getSnapshot();
    expect(noServiceSnapshot.buildings.some(({ type }) => type === 'service')).toBe(false);
    expect(noServiceSnapshot.failedServiceDestinationAttempts).toBeGreaterThan(0);
    expect(noDestinationMaxNeed).toBe(SERVICE_NEED_MAX);
    expect(
      noServiceSnapshot.citizens.some(({ serviceNeed }) => serviceNeed === SERVICE_NEED_MAX),
    ).toBe(true);
    expect(noServiceSnapshot.citizens.every(({ activity }) => activity !== 'service')).toBe(true);
  }, 60_000);

  it('exposes the Services demand components and changes only matching seed influence', () => {
    expect(
      calculateServicesDemand({
        serviceNeedPressure: 0.25,
        serviceCapacityShortage: 0.5,
        localCapacityCoverage: 0.25,
      }),
    ).toEqual({
      needPressureContribution: 0.0825,
      capacityShortageContribution: 0.11,
      localCoverageContribution: 0.3375,
      value: 0.53,
    });
    expect(
      calculateServicesDemand({
        serviceNeedPressure: 1,
        serviceCapacityShortage: 1,
        localCapacityCoverage: 0,
        enabled: false,
      }).value,
    ).toBe(0);
    expect(SERVICES_LOCAL_CAPACITY_RADIUS).toBe(8);

    const home: Building = {
      id: 'home',
      type: 'home',
      footprint: { x: 2, y: 2, width: 3, height: 3 },
      entrance: { x: 2, y: 1 },
      capacity: 1,
    };
    const work: Building = {
      id: 'work',
      type: 'workplace',
      footprint: { x: 10, y: 2, width: 5, height: 5 },
      entrance: { x: 10, y: 1 },
      capacity: 1,
    };
    const citizen = { homeBuildingId: home.id, workplaceBuildingId: work.id, serviceNeed: 4 };
    const shortage = calculateCityDemand({
      width: 16,
      height: 10,
      buildings: [home, work],
      citizens: [citizen],
      metrics: { space: 1, access: 1, activity: 1 },
      servicesEnabled: true,
    });
    const service: Building = {
      id: 'service',
      type: 'service',
      footprint: { x: 6, y: 0, width: 4, height: 4 },
      entrance: { x: 6, y: 4 },
      capacity: SERVICE_BUILDING_CAPACITY,
    };
    const covered = calculateCityDemand({
      width: 16,
      height: 10,
      buildings: [home, work, service],
      citizens: [citizen],
      metrics: { space: 1, access: 1, activity: 1 },
      servicesEnabled: true,
    });
    const needFree = calculateCityDemand({
      width: 16,
      height: 10,
      buildings: [home, work],
      citizens: [{ ...citizen, serviceNeed: 0 }],
      metrics: { space: 1, access: 1, activity: 1 },
      servicesEnabled: true,
    });
    expect(shortage.cells[0]?.services).toBeGreaterThan(needFree.cells[0]?.services ?? 0);
    expect(covered.cells[0]?.services).toBeLessThan(shortage.cells[0]?.services ?? 1);

    const simulation = createCoreProgression();
    installServicesCore(simulation);
    const position = firstValidSeedPosition(simulation, 'services', 3, 3);
    const beforeSeed = simulation.queryDemandRegion({
      x: position.x,
      y: position.y,
      width: 1,
      height: 1,
    }).cells[0];
    expect(simulation.placeDistrictSeed({ kind: 'services', position }).accepted).toBe(true);
    const afterSeed = simulation.queryDemandRegion({
      x: position.x,
      y: position.y,
      width: 1,
      height: 1,
    }).cells[0];
    if (beforeSeed === undefined || afterSeed === undefined)
      throw new Error('Demand cells are required.');
    expect(afterSeed.services).toBeGreaterThanOrEqual(beforeSeed.services);
    expect(afterSeed.living).toBe(beforeSeed.living);
    expect(afterSeed.working).toBe(beforeSeed.working);
  }, 60_000);
});
