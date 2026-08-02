import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { createSimulation, type SimulationSnapshot } from '@idle-city/simulation';
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

describe('visible chunk city scene', () => {
  it('renders only selected chunks with bounded mesh counts and disposes without WebGL', () => {
    const engine = new NullEngine();
    const snapshot = createSimulation({ citizenCount: 3 }).getSnapshot();
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
    const snapshot = createSimulation({ citizenCount: 1 }).getSnapshot();
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
      homePosition: { x: -6, y: -6 },
      workplacePosition: { x: 10, y: 10 },
      citizenCount: 1,
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
    const initial = createSimulation({ citizenCount: 1 }).getSnapshot();
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
      simulation.placeDistrictSeed({ kind: 'living', position: { x: 4, y: 4 } }).accepted,
    ).toBe(true);
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

  it('keeps shared entities stable on repeated updates and sizes buildings by footprint', () => {
    const engine = new NullEngine();
    const initial = createSimulation({ citizenCount: 1 }).getSnapshot();
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
    const initial = createSimulation({ citizenCount: 1 }).getSnapshot();
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
