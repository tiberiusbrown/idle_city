import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import {
  createSimulation,
  type ConstructionProject,
  type SimulationSnapshot,
} from '@idle-city/simulation';
import { describe, expect, it } from 'vitest';
import { createCityScene, logicalToWorld } from '../src/index';

function replaceSnapshot(
  snapshot: SimulationSnapshot,
  changes: Partial<
    Pick<SimulationSnapshot, 'buildings' | 'citizens' | 'constructionProjects' | 'seeds'>
  >,
): SimulationSnapshot {
  return { ...snapshot, ...changes };
}

const renderBuildings = [
  { id: 'home-1', type: 'home' as const, origin: { x: 1, y: 1 } },
  { id: 'home-2', type: 'home' as const, origin: { x: 1, y: 8 } },
  { id: 'home-3', type: 'home' as const, origin: { x: 8, y: 1 } },
  { id: 'workplace-1', type: 'workplace' as const, origin: { x: 10, y: 8 } },
];

function renderSimulation(citizenCount: number) {
  return createSimulation({
    initialActiveRegion: { minX: 0, minY: 0, width: 4, height: 4 },
    initialBuildings: renderBuildings,
    initialCitizens: Array.from({ length: citizenCount }, (_, index) => ({
      id: `citizen-${String(index + 1)}`,
      homeBuildingId: `home-${String((index % 3) + 1)}`,
      workplaceBuildingId: 'workplace-1',
    })),
  });
}

describe('visible chunk city scene', () => {
  it('renders only selected chunks with bounded mesh counts and disposes without WebGL', () => {
    const engine = new NullEngine();
    const snapshot = renderSimulation(3).getSnapshot();
    const city = createCityScene(engine, snapshot, {
      visibleChunks: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
    const counters = city.getStructuralCounters();
    expect(counters.visibleChunks).toBe(2);
    expect(counters.renderedChunks).toBe(2);
    expect(counters.chunkRebuilds).toBe(2);
    expect(counters.visibleCitizens).toBe(snapshot.citizens.length);
    expect(counters.renderedCitizens).toBe(snapshot.citizens.length);
    expect(counters.meshCount).toBeLessThan(
      2 + snapshot.buildings.length * 2 + snapshot.citizens.length * 2 + 2,
    );
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    expect(city.scene.getTransformNodeByName('building-home-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('rebuilds ground only when a visible chunk revision changes', () => {
    const engine = new NullEngine();
    const snapshot = renderSimulation(1).getSnapshot();
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: 0, y: 0 }] });
    const initialCounters = city.getStructuralCounters();
    city.update(snapshot, 0.5);
    expect(city.getStructuralCounters().chunkRebuilds).toBe(initialCounters.chunkRebuilds);

    const changed = {
      ...snapshot,
      activeChunks: snapshot.activeChunks.map((chunk) =>
        chunk.key === '0:0' ? { ...chunk, occupancyRevision: chunk.occupancyRevision + 1 } : chunk,
      ),
    };
    city.update(changed, 0.5);
    expect(city.getStructuralCounters().chunkRebuilds).toBe(initialCounters.chunkRebuilds + 1);
    city.dispose();
    engine.dispose();
  });

  it('updates interpolation across signed coordinates without mutating snapshots', () => {
    const engine = new NullEngine();
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: -1, minY: -1, width: 3, height: 3 },
      initialBuildings: [
        { id: 'home-1', type: 'home', origin: { x: -6, y: -6 } },
        { id: 'workplace-1', type: 'workplace', origin: { x: 10, y: 10 } },
      ],
      initialCitizens: [
        { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-1' },
      ],
      activityDurationTicks: 1,
    });
    for (let tick = 0; tick < 3; tick += 1) simulation.step();
    const snapshot = simulation.getSnapshot();
    const before = JSON.stringify(snapshot);
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: -1, y: -1 }] });
    city.update(snapshot, 0.35);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(logicalToWorld({ x: -1, y: -1 }).x).toBeCloseTo(-0.125);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('reconciles citizens, buildings, and seeds by authoritative ID', () => {
    const engine = new NullEngine();
    const initial = renderSimulation(1).getSnapshot();
    const city = createCityScene(engine, initial, { visibleChunks: [{ x: 0, y: 0 }] });
    const home = initial.buildings.find((building) => building.type === 'home');
    if (home === undefined) throw new Error('The fixture requires a home.');
    const seed = { id: 'district-seed-test', kind: 'living' as const, position: { x: 4, y: 4 } };

    const removed = replaceSnapshot(initial, {
      citizens: [],
      buildings: initial.buildings.filter((building) => building.id !== home.id),
      seeds: [seed],
    });
    city.update(removed, 1);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).toBeNull();
    expect(city.scene.getTransformNodeByName(`building-${home.id}`)).toBeNull();
    expect(city.scene.getTransformNodeByName(`seed-${seed.id}`)).not.toBeNull();
    expect(city.scene.getMeshByName(`${seed.id}-marker`)).not.toBeNull();
    expect(city.scene.getMeshByName(`${seed.id}-influence`)).not.toBeNull();
    expect(city.scene.getMeshByName(`${seed.id}-influence`)?.isVisible).toBe(false);
    city.setSeedInfluenceVisibility({ selectedSeedId: seed.id });
    expect(city.scene.getMeshByName(`${seed.id}-influence`)?.isVisible).toBe(true);
    city.setSeedInfluenceVisibility({});
    expect(city.scene.getMeshByName(`${seed.id}-influence`)?.isVisible).toBe(false);
    const removedMeshCount = city.scene.meshes.length;
    city.update(removed, 1);
    expect(city.scene.meshes.length).toBe(removedMeshCount);

    city.update(initial, 1);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    expect(city.scene.getTransformNodeByName(`building-${home.id}`)).not.toBeNull();
    expect(city.scene.getTransformNodeByName(`seed-${seed.id}`)).toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('renders only citizens touching visible chunks, reuses visuals, and restores interpolation', () => {
    const engine = new NullEngine();
    const simulation = renderSimulation(1);
    const initial = simulation.getSnapshot();
    const city = createCityScene(engine, initial, { visibleChunks: [{ x: 0, y: 0 }] });
    const citizen = initial.citizens[0];
    if (citizen === undefined) throw new Error('The fixture requires a citizen.');
    const crossing = replaceSnapshot(initial, {
      citizens: [
        {
          ...citizen,
          previousPosition: { x: 31, y: 3 },
          position: { x: 32, y: 3 },
        },
      ],
    });
    const crossingBefore = JSON.stringify(crossing);
    city.update(crossing, 0.5);
    const root = city.scene.getTransformNodeByName('render-citizen-1');
    if (root === null) throw new Error('The crossing citizen should remain visible.');
    expect(city.getStructuralCounters().visibleCitizens).toBe(1);
    expect(city.getStructuralCounters().renderedCitizens).toBe(1);
    expect(root.position.x).toBeCloseTo((31.5 + 0.5) * 0.25);
    const meshCount = city.scene.meshes.length;

    city.update(crossing, 0.5);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).toBe(root);
    expect(city.scene.meshes.length).toBe(meshCount);

    const offscreen = replaceSnapshot(crossing, {
      citizens: [
        {
          ...citizen,
          previousPosition: { x: 32, y: 3 },
          position: { x: 33, y: 3 },
        },
      ],
    });
    const offscreenBefore = JSON.stringify(offscreen);
    city.update(offscreen, 1);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).toBeNull();
    expect(city.getStructuralCounters().visibleCitizens).toBe(0);
    expect(city.getStructuralCounters().renderedCitizens).toBe(0);
    expect(JSON.stringify(crossing)).toBe(crossingBefore);
    expect(JSON.stringify(offscreen)).toBe(offscreenBefore);

    city.setVisibleChunks([{ x: 1, y: 0 }]);
    city.update(offscreen, 0.5);
    expect(city.scene.getTransformNodeByName('render-citizen-1')).not.toBeNull();
    expect(city.getStructuralCounters().renderedCitizens).toBe(1);

    city.setVisibleChunks([{ x: 0, y: 0 }]);
    city.update(crossing, 0.25);
    const reentered = city.scene.getTransformNodeByName('render-citizen-1');
    if (reentered === null) throw new Error('The citizen should re-enter the visible chunk.');
    expect(reentered.position.x).toBeCloseTo((31.25 + 0.5) * 0.25);
    expect(JSON.stringify(crossing)).toBe(crossingBefore);
    city.dispose();
    engine.dispose();
  });

  it('does not create off-screen citizen visuals', () => {
    const engine = new NullEngine();
    const snapshot = renderSimulation(2).getSnapshot();
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: 1, y: 0 }] });
    expect(city.scene.getTransformNodeByName('render-citizen-1')).toBeNull();
    expect(city.scene.getTransformNodeByName('render-citizen-2')).toBeNull();
    expect(city.getStructuralCounters().visibleCitizens).toBe(0);
    expect(city.getStructuralCounters().renderedCitizens).toBe(0);
    city.dispose();
    engine.dispose();
  });

  it('reuses one valid or invalid placement preview mesh', () => {
    const engine = new NullEngine();
    const snapshot = createSimulation().getSnapshot();
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: 0, y: 0 }] });
    city.setPlacementPreview({ position: { x: 6, y: 6 }, valid: true });
    const preview = city.scene.getMeshByName('placement-preview');
    if (preview === null) throw new Error('The placement preview was not rendered.');
    expect(preview.isVisible).toBe(true);
    expect(preview.material?.name).toBe('placement-valid-material');
    const meshCount = city.scene.meshes.length;

    city.setPlacementPreview({ position: { x: 7, y: 6 }, valid: false });
    expect(city.scene.meshes.length).toBe(meshCount);
    expect(preview.material?.name).toBe('placement-invalid-material');
    expect(preview.position.x).toBeCloseTo((7 + 0.5) * 0.25);
    city.setPlacementPreview(undefined);
    expect(preview.isVisible).toBe(false);
    city.dispose();
    engine.dispose();
  });

  it('toggles planning materials and seed zones without allocating new resources', () => {
    const engine = new NullEngine();
    const initial = renderSimulation(1).getSnapshot();
    const seed = { id: 'planning-seed', kind: 'living' as const, position: { x: 4, y: 4 } };
    const snapshot = replaceSnapshot(initial, { seeds: [seed] });
    const city = createCityScene(engine, snapshot, { visibleChunks: [{ x: 0, y: 0 }] });
    const body = city.scene.getMeshByName('home-1-body');
    const influence = city.scene.getMeshByName('planning-seed-influence');
    if (body === null || influence === null) throw new Error('Planning visuals are required.');
    const normalMaterial = body.material;
    city.setPlanningMode({
      active: true,
      candidate: { position: { x: 6, y: 6 }, valid: false, sideLength: 17 },
    });
    expect(body.material?.name).toBe('planning-building-material');
    expect(body.material).not.toBe(normalMaterial);
    expect(influence.isVisible).toBe(true);
    expect(city.scene.getMeshByName('placement-preview')?.material?.name).toBe(
      'placement-invalid-material',
    );
    const preview = city.scene.getMeshByName('placement-preview');
    const activeInfluence = city.scene.getMeshByName('placement-preview-active-influence');
    if (preview === null || activeInfluence === null)
      throw new Error('Preview resources are required.');
    const initialActivePositions = activeInfluence.getVerticesData('position')?.slice();
    const planningMeshCount = city.scene.meshes.length;
    city.setPlanningMode({
      active: true,
      candidate: { position: { x: 7, y: 6 }, valid: true, sideLength: 17 },
      selected: false,
    });
    expect(city.scene.getMeshByName('placement-preview-active-influence')).toBe(activeInfluence);
    expect(activeInfluence.getVerticesData('position')).not.toEqual(initialActivePositions);
    expect(city.scene.meshes.length).toBe(planningMeshCount);
    const hoverScale = preview.scaling.x;
    city.setPlanningMode({
      active: true,
      candidate: {
        position: { x: 7, y: 6 },
        valid: true,
        sideLength: 17,
        activeCoveredCells: [{ x: 7, y: 6 }],
      },
      selected: false,
    });
    city.setPlanningMode({
      active: true,
      candidate: {
        position: { x: 8, y: 6 },
        valid: true,
        sideLength: 17,
        activeCoveredCells: [
          { x: 8, y: 6 },
          { x: 8, y: 7 },
          { x: 9, y: 6 },
        ],
      },
      selected: false,
    });
    expect(city.scene.getMeshByName('placement-preview-active-influence')).toBe(activeInfluence);
    expect(city.scene.meshes.length).toBe(planningMeshCount);
    city.setPlanningMode({
      active: true,
      candidate: { position: { x: 8, y: 6 }, valid: true, sideLength: 17 },
      selected: true,
    });
    expect(city.scene.getMeshByName('placement-preview-active-influence')).toBe(activeInfluence);
    expect(city.scene.meshes.length).toBe(planningMeshCount);
    expect(preview.scaling.x).toBeGreaterThan(hoverScale);
    expect(city.scene.meshes.length).toBe(planningMeshCount);
    city.setPlanningMode({ active: false });
    expect(body.material).toBe(normalMaterial);
    expect(influence.isVisible).toBe(false);
    expect(city.scene.getMeshByName('placement-preview')?.isVisible).toBe(false);
    city.dispose();
    engine.dispose();
  });

  it('renders construction phases, removes projects, and shows the replacement building', () => {
    const engine = new NullEngine();
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 2, height: 2 },
      homePosition: { x: 0, y: 0 },
      workplacePosition: { x: 8, y: 8 },
      citizenCount: 1,
      startingData: 10,
      developmentEvaluationIntervalTicks: 1,
      constructionPhaseDurations: {
        survey: 1,
        blueprint: 1,
        foundation: 1,
        frame: 1,
        completion: 1,
      },
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted,
    ).toBe(true);
    simulation.step();
    simulation.step();
    const projectSnapshot = simulation.getSnapshot();
    const project = projectSnapshot.constructionProjects[0];
    if (project === undefined) throw new Error('The fixture requires a project.');
    const city = createCityScene(engine, projectSnapshot, { visibleChunks: [{ x: 0, y: 0 }] });
    const projectMeshNames = ['survey', 'blueprint', 'foundation', 'frame', 'completion'].map(
      (phase) => `${project.id}-${phase}`,
    );
    expect(projectMeshNames.every((name) => city.scene.getMeshByName(name) !== null)).toBe(true);

    for (const phase of ['survey', 'blueprint', 'foundation', 'frame', 'completion'] as const) {
      const phaseSnapshot = replaceSnapshot(projectSnapshot, {
        constructionProjects: [{ ...project, phase }],
      });
      city.update(phaseSnapshot, 1);
      for (const candidate of [
        'survey',
        'blueprint',
        'foundation',
        'frame',
        'completion',
      ] as const) {
        const mesh = city.scene.getMeshByName(`${project.id}-${candidate}`);
        if (mesh === null) throw new Error(`Missing ${candidate} project visual.`);
        expect(mesh.isVisible).toBe(candidate === phase);
      }
    }

    const building = {
      id: 'home-replacement',
      type: project.buildingType,
      footprint: { ...project.footprint },
      entrance: { ...project.entrance },
      capacity: project.capacity,
    };
    city.update(
      replaceSnapshot(projectSnapshot, {
        constructionProjects: [],
        buildings: [...projectSnapshot.buildings, building],
      }),
      1,
    );
    expect(city.scene.getTransformNodeByName(`construction-${project.id}`)).toBeNull();
    expect(city.scene.getTransformNodeByName(`building-${building.id}`)).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('reconciles a distinct Services building and construction visual by stable ID', () => {
    const engine = new NullEngine();
    const initial = createSimulation({ citizenCount: 0 }).getSnapshot();
    const serviceBuilding = {
      id: 'service-2',
      type: 'service' as const,
      footprint: { x: 6, y: 6, width: 4, height: 4 },
      entrance: { x: 6, y: 5 },
      capacity: 8,
    };
    const serviceProject: ConstructionProject = {
      id: 'construction-service-1',
      buildingType: 'service',
      footprint: { x: 10, y: 6, width: 4, height: 4 },
      entrance: { x: 10, y: 5 },
      capacity: 8,
      phase: 'foundation',
      phaseLaborCompleted: 2,
      phaseLaborRequired: 8,
      workerCount: 0,
      paused: true,
      phaseTicksRemaining: 1,
      phaseTicksElapsed: 1,
      totalTicksElapsed: 1,
      startedTick: 0,
      score: 0.5,
      primaryReason: {
        code: 'local-matching-demand',
        text: 'Local demand for service building capacity is high.',
        scoreContribution: 0.3,
      },
      seedInfluence: 0.5,
      spatialFactor: 0.5,
      expectedAccessImprovement: 0.5,
      envelope: { x: 9, y: 5, width: 6, height: 6 },
      stagingCells: [
        { x: 10, y: 5 },
        { x: 9, y: 6 },
        { x: 11, y: 5 },
      ],
    };
    const city = createCityScene(engine, initial, { visibleChunks: [{ x: 0, y: 0 }] });
    const serviceSnapshot = replaceSnapshot(initial, {
      buildings: [...initial.buildings, serviceBuilding],
      constructionProjects: [serviceProject],
    });
    city.update(serviceSnapshot, 1);
    const serviceBody = city.scene.getMeshByName(`${serviceBuilding.id}-body`);
    if (serviceBody === null) throw new Error('The Services building body is required.');
    expect(serviceBody.material?.name).toBe('service-material');
    expect(serviceBody.scaling.x).toBeCloseTo(1);
    expect(serviceBody.scaling.z).toBeCloseTo(1);
    expect(city.scene.getMeshByName(`${serviceProject.id}-foundation`)).not.toBeNull();
    expect(city.scene.getMeshByName(`${serviceProject.id}-foundation`)?.material?.name).toBe(
      'construction-paused-material',
    );

    city.update(
      replaceSnapshot(serviceSnapshot, {
        buildings: [...initial.buildings, serviceBuilding],
        constructionProjects: [],
      }),
      1,
    );
    expect(city.scene.getTransformNodeByName(`construction-${serviceProject.id}`)).toBeNull();
    expect(city.scene.getTransformNodeByName(`building-${serviceBuilding.id}`)).not.toBeNull();
    city.dispose();
    engine.dispose();
  });

  it('renders labor progress, paused construction, and distinct construction citizens', () => {
    const engine = new NullEngine();
    const simulation = createSimulation({
      chunkSize: 8,
      initialChunkRegion: { minX: 0, minY: 0, width: 4, height: 4 },
      initialBuildings: renderBuildings,
      initialCitizens: [
        { id: 'citizen-1', homeBuildingId: 'home-1', workplaceBuildingId: 'workplace-1' },
        { id: 'citizen-2', homeBuildingId: 'home-2', workplaceBuildingId: 'workplace-1' },
        { id: 'citizen-3', homeBuildingId: 'home-3', workplaceBuildingId: 'workplace-1' },
      ],
      populationCap: 3,
      activityDurationTicks: 1,
      developmentEvaluationIntervalTicks: 1,
      startingData: 10,
    });
    expect(
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 5, y: 1 } }).accepted,
    ).toBe(true);
    for (let tick = 0; tick < 20; tick += 1) {
      simulation.step();
      if (simulation.getSnapshot().constructionProjects.length > 0) break;
    }
    const projectSnapshot = simulation.getSnapshot();
    const project = projectSnapshot.constructionProjects[0];
    if (project === undefined) throw new Error('The fixture requires a construction project.');
    const city = createCityScene(engine, projectSnapshot, {
      visibleChunks: projectSnapshot.activeChunks.map(({ chunk }) => chunk),
    });
    const paused = replaceSnapshot(projectSnapshot, {
      constructionProjects: [
        {
          ...project,
          phase: 'foundation',
          phaseLaborCompleted: 0,
          phaseLaborRequired: 8,
          paused: true,
        },
      ],
    });
    city.update(paused, 1);
    const foundation = city.scene.getMeshByName(`${project.id}-foundation`);
    if (foundation === null) throw new Error('The foundation visual is required.');
    const pausedHeight = foundation.scaling.y;
    expect(foundation.material?.name).toBe('construction-paused-material');
    const progress = replaceSnapshot(paused, {
      constructionProjects: [
        {
          ...project,
          phase: 'foundation',
          phaseLaborCompleted: 4,
          phaseLaborRequired: 8,
          paused: false,
        },
      ],
    });
    city.update(progress, 1);
    expect(foundation.scaling.y).toBeGreaterThan(pausedHeight);
    expect(foundation.material?.name).toBe('construction-foundation-material');

    const citizen = projectSnapshot.citizens[0];
    const stagingCell = project.stagingCells[0];
    if (citizen === undefined || stagingCell === undefined) {
      throw new Error('The fixture requires a citizen and staging cell.');
    }
    const constructionCitizen = {
      ...citizen,
      position: { ...stagingCell },
      previousPosition: { ...stagingCell },
      activity: 'constructing' as const,
      route: [{ ...stagingCell }],
      routeIndex: 0,
      constructionProjectId: project.id,
      constructionStagingCell: { ...stagingCell },
      resumeDestinationBuildingId: citizen.workplaceBuildingId,
    };
    const constructionSnapshot = replaceSnapshot(progress, {
      citizens: [constructionCitizen, ...projectSnapshot.citizens.slice(1)],
    });
    city.update(constructionSnapshot, 1);
    expect(city.scene.getMeshByName(`${constructionCitizen.id}-body`)?.material?.name).toBe(
      'construction-citizen-material',
    );
    const meshCount = city.scene.meshes.length;
    city.update(constructionSnapshot, 1);
    expect(city.scene.meshes.length).toBe(meshCount);
    city.dispose();
    engine.dispose();
  });

  it('keeps shared entities stable on repeated updates and sizes buildings by footprint', () => {
    const engine = new NullEngine();
    const initial = renderSimulation(1).getSnapshot();
    const city = createCityScene(engine, initial, {
      visibleChunks: [{ x: 0, y: 0 }],
      cellWorldScale: 0.5,
    });
    const customBuilding = {
      id: 'custom-footprint-building',
      type: 'home' as const,
      footprint: { x: 5, y: 5, width: 3, height: 5 },
      entrance: { x: 5, y: 4 },
      capacity: 3,
    };
    const changed = replaceSnapshot(initial, {
      buildings: [...initial.buildings, customBuilding],
    });
    city.update(changed, 1);
    const firstMeshCount = city.scene.meshes.length;
    const firstRoot = city.scene.getTransformNodeByName(`building-${customBuilding.id}`);
    const body = city.scene.getMeshByName(`${customBuilding.id}-body`);
    if (firstRoot === null || body === null)
      throw new Error('The custom building was not rendered.');
    expect(body.scaling.x).toBeCloseTo(1.5);
    expect(body.scaling.z).toBeCloseTo(2.5);
    expect(firstRoot.position.x).toBeCloseTo(6.5 * 0.5);
    const homeBody = city.scene.getMeshByName('home-1-body');
    if (homeBody === null) throw new Error('The fixture requires the initial home visual.');
    expect(body.material).toBe(homeBody.material);
    city.update(changed, 1);
    expect(city.scene.meshes.length).toBe(firstMeshCount);
    expect(city.scene.getTransformNodeByName(`building-${customBuilding.id}`)).toBe(firstRoot);
    city.dispose();
    engine.dispose();
  });

  it('uses scaled interpolation without writing to a snapshot and fully disposes the scene', () => {
    const engine = new NullEngine();
    const initial = renderSimulation(1).getSnapshot();
    const moved = replaceSnapshot(initial, {
      citizens: initial.citizens.map((citizen) => ({
        ...citizen,
        previousPosition: { x: -2, y: 3 },
        position: { x: 2, y: 7 },
      })),
    });
    const before = JSON.stringify(moved);
    const city = createCityScene(engine, initial, {
      visibleChunks: [{ x: 0, y: 0 }],
      cellWorldScale: 0.5,
    });
    city.update(moved, 0.25);
    const citizen = city.scene.getTransformNodeByName('render-citizen-1');
    if (citizen === null) throw new Error('The fixture requires a citizen.');
    expect(citizen.position.x).toBeCloseTo((-1 + 0.5) * 0.5);
    expect(citizen.position.z).toBeCloseTo((4 + 0.5) * 0.5);
    expect(JSON.stringify(moved)).toBe(before);
    city.dispose();
    expect(city.scene.meshes).toHaveLength(0);
    expect(city.scene.transformNodes).toHaveLength(0);
    expect(city.scene.materials).toHaveLength(0);
    city.dispose();
    engine.dispose();
  });
});
