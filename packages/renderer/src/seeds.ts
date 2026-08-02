import {
  chunkCoordinateForPosition,
  chunkKey,
  enumerateDistrictSeedInfluenceCells,
  type DistrictSeed,
  type DistrictSeedDefinition,
  type DistrictSeedKind,
} from '@idle-city/simulation';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateLineSystem, CreateLines } from '@babylonjs/core/Meshes/Builders/linesBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { logicalToWorld } from './coordinates';
import type { CityMaterials } from './materials';

export interface SeedVisibilityOptions {
  readonly selectedSeedId?: string;
  readonly overlayActive?: boolean;
  readonly placing?: boolean;
  readonly relocating?: boolean;
}

export interface SeedLayer {
  reconcile(
    seeds: readonly DistrictSeed[],
    activeChunks?: readonly { readonly chunk: { x: number; y: number }; readonly key: string }[],
    chunkSize?: number,
  ): void;
  setVisibility(options: SeedVisibilityOptions): void;
  dispose(): void;
}

interface SeedVisual {
  readonly root: TransformNode;
  readonly marker: ReturnType<typeof CreateCylinder>;
  readonly influence: ReturnType<typeof CreateLines>;
  activeInfluence: ReturnType<typeof CreateLineSystem>;
  activeInfluenceKey: string;
}

type SeedDefinitions = Readonly<Record<DistrictSeedKind, DistrictSeedDefinition>>;

function markerMaterial(seed: DistrictSeed, materials: CityMaterials) {
  switch (seed.kind) {
    case 'living':
      return materials.seedLiving;
    case 'working':
      return materials.seedWorking;
    case 'services':
      return materials.seedServices;
  }
}

function influenceMaterial(seed: DistrictSeed, materials: CityMaterials) {
  switch (seed.kind) {
    case 'living':
      return materials.influenceLiving;
    case 'working':
      return materials.influenceWorking;
    case 'services':
      return materials.influenceServices;
  }
}

function legacyDefinitions(radius: number): SeedDefinitions {
  const definition = (
    kind: DistrictSeedKind,
    label: string,
    baseCost: number,
  ): DistrictSeedDefinition => ({
    kind,
    label,
    baseCost,
    influenceRadius: radius,
    sideLength: radius * 2 + 1,
    influenceShape: 'square',
    unlocked: true,
  });
  return {
    living: definition('living', 'Living', 10),
    working: definition('working', 'Working', 12),
    services: definition('services', 'Services', 20),
  };
}

function squareOutlinePoints(sideLength: number, cellWorldScale: number): Vector3[] {
  const halfExtent = (sideLength / 2) * cellWorldScale;
  return [
    new Vector3(-halfExtent, 0, -halfExtent),
    new Vector3(halfExtent, 0, -halfExtent),
    new Vector3(halfExtent, 0, halfExtent),
    new Vector3(-halfExtent, 0, halfExtent),
    new Vector3(-halfExtent, 0, -halfExtent),
  ];
}

function activeBoundaryLines(
  seed: DistrictSeed,
  activeCells: readonly { readonly x: number; readonly y: number }[],
  cellWorldScale: number,
): Vector3[][] {
  const active = new Set(activeCells.map((cell) => `${String(cell.x)},${String(cell.y)}`));
  const lines: Vector3[][] = [];
  const edges = [
    { x: 0, y: -1, a: [-0.5, -0.5], b: [0.5, -0.5] },
    { x: 1, y: 0, a: [0.5, -0.5], b: [0.5, 0.5] },
    { x: 0, y: 1, a: [0.5, 0.5], b: [-0.5, 0.5] },
    { x: -1, y: 0, a: [-0.5, 0.5], b: [-0.5, -0.5] },
  ] as const;
  for (const cell of activeCells) {
    for (const edge of edges) {
      const neighborKey = `${String(cell.x + edge.x)},${String(cell.y + edge.y)}`;
      if (active.has(neighborKey)) continue;
      const centerX = (cell.x - seed.position.x) * cellWorldScale;
      const centerZ = (cell.y - seed.position.y) * cellWorldScale;
      lines.push([
        new Vector3(centerX + edge.a[0] * cellWorldScale, 0, centerZ + edge.a[1] * cellWorldScale),
        new Vector3(centerX + edge.b[0] * cellWorldScale, 0, centerZ + edge.b[1] * cellWorldScale),
      ]);
    }
  }
  return lines;
}

export function createSeedLayer(
  scene: Scene,
  cellWorldScale: number,
  definitionsOrRadius: SeedDefinitions | number,
  materials: CityMaterials,
): SeedLayer {
  const definitions =
    typeof definitionsOrRadius === 'number'
      ? legacyDefinitions(definitionsOrRadius)
      : definitionsOrRadius;
  const visuals = new Map<string, SeedVisual>();
  let visibility: SeedVisibilityOptions = {};
  let disposed = false;

  const shouldShowInfluence = (seedId: string): boolean =>
    visibility.overlayActive === true ||
    visibility.placing === true ||
    visibility.relocating === true ||
    visibility.selectedSeedId === seedId;

  const createVisual = (seed: DistrictSeed): SeedVisual => {
    const definition = definitions[seed.kind];
    const root = new TransformNode(`seed-${seed.id}`, scene);
    const marker = CreateCylinder(
      `${seed.id}-marker`,
      { diameter: 0.32, height: 0.18, tessellation: 6 },
      scene,
    );
    marker.parent = root;
    marker.position.y = 0.18;
    marker.material = markerMaterial(seed, materials);
    marker.isPickable = false;
    const influence = CreateLines(
      `${seed.id}-influence`,
      { points: squareOutlinePoints(definition.sideLength, cellWorldScale) },
      scene,
    );
    influence.parent = root;
    influence.position.y = 0.02;
    influence.material = influenceMaterial(seed, materials);
    influence.isPickable = false;
    const activeInfluence = CreateLineSystem(
      `${seed.id}-active-influence`,
      { lines: [[Vector3.Zero(), Vector3.Zero()]] },
      scene,
    );
    activeInfluence.parent = root;
    activeInfluence.position.y = 0.025;
    activeInfluence.material = influenceMaterial(seed, materials);
    activeInfluence.isPickable = false;
    return { root, marker, influence, activeInfluence, activeInfluenceKey: '' };
  };

  const updateVisual = (
    visual: SeedVisual,
    seed: DistrictSeed,
    activeCells: readonly { readonly x: number; readonly y: number }[],
  ): void => {
    visual.root.position = logicalToWorld(seed.position, cellWorldScale);
    visual.marker.material = markerMaterial(seed, materials);
    visual.influence.material = influenceMaterial(seed, materials);
    const activeKey = activeCells.map((cell) => `${String(cell.x)},${String(cell.y)}`).join('|');
    if (visual.activeInfluenceKey !== activeKey) {
      const replacement = CreateLineSystem(
        `${seed.id}-active-influence`,
        { lines: activeBoundaryLines(seed, activeCells, cellWorldScale) },
        scene,
      );
      replacement.parent = visual.root;
      replacement.position.y = 0.025;
      replacement.material = influenceMaterial(seed, materials);
      replacement.isPickable = false;
      visual.activeInfluence.dispose();
      visual.activeInfluence = replacement;
      visual.activeInfluenceKey = activeKey;
    }
    const show = shouldShowInfluence(seed.id);
    visual.influence.isVisible = show;
    visual.activeInfluence.isVisible = show && activeCells.length > 0;
  };

  return {
    reconcile(seeds: readonly DistrictSeed[], activeChunks = [], chunkSize = 32): void {
      if (disposed) throw new Error('Cannot update a disposed seed layer.');
      const activeKeys = new Set(activeChunks.map((chunk) => chunk.key));
      const desiredIds = new Set<string>();
      for (const seed of seeds) {
        if (desiredIds.has(seed.id)) throw new Error(`Duplicate district seed ID ${seed.id}.`);
        desiredIds.add(seed.id);
        const visual = visuals.get(seed.id);
        const current = visual ?? createVisual(seed);
        if (visual === undefined) visuals.set(seed.id, current);
        const allCells = enumerateDistrictSeedInfluenceCells(seed.position, seed.kind);
        const activeCells = allCells.filter((cell) =>
          activeKeys.has(chunkKey(chunkCoordinateForPosition(cell, chunkSize))),
        );
        // The chunk size is only used for an active-coverage hint when a
        // caller supplies no richer renderer metadata. The simulation keeps
        // the exact authoritative square in the seed definition.
        updateVisual(current, seed, activeChunks.length === 0 ? [] : activeCells);
      }
      for (const [id, visual] of visuals) {
        if (desiredIds.has(id)) continue;
        visual.root.dispose();
        visuals.delete(id);
      }
    },
    setVisibility(next: SeedVisibilityOptions): void {
      if (disposed) throw new Error('Cannot change seed visibility on a disposed layer.');
      visibility = { ...next };
      for (const [id, visual] of visuals) {
        const show = shouldShowInfluence(id);
        visual.influence.isVisible = show;
        visual.activeInfluence.isVisible = show && visual.activeInfluenceKey.length > 0;
      }
    },
    dispose(): void {
      if (disposed) return;
      for (const visual of visuals.values()) visual.root.dispose();
      visuals.clear();
      disposed = true;
    },
  };
}
