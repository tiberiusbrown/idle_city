import type { DistrictSeed } from '@idle-city/simulation';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { logicalToWorld } from './coordinates';
import type { CityMaterials } from './materials';

export interface SeedLayer {
  reconcile(seeds: readonly DistrictSeed[]): void;
  dispose(): void;
}

interface SeedVisual {
  readonly root: TransformNode;
  readonly marker: ReturnType<typeof CreateCylinder>;
  readonly influence: ReturnType<typeof CreateCylinder>;
}

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

export function createSeedLayer(
  scene: Scene,
  cellWorldScale: number,
  influenceRadius: number,
  materials: CityMaterials,
): SeedLayer {
  if (!Number.isSafeInteger(influenceRadius) || influenceRadius < 1) {
    throw new Error(
      `seedInfluenceRadius must be a positive safe integer; received ${String(influenceRadius)}.`,
    );
  }
  const visuals = new Map<string, SeedVisual>();
  let disposed = false;

  const createVisual = (seed: DistrictSeed): SeedVisual => {
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
    const influence = CreateCylinder(
      `${seed.id}-influence`,
      {
        diameter: (influenceRadius * 2 + 1) * cellWorldScale,
        height: 0.025,
        tessellation: 4,
      },
      scene,
    );
    influence.parent = root;
    influence.position.y = 0.012;
    influence.rotation.y = Math.PI / 4;
    influence.material = influenceMaterial(seed, materials);
    influence.isPickable = false;
    return { root, marker, influence };
  };

  const updateVisual = (visual: SeedVisual, seed: DistrictSeed): void => {
    visual.root.position = logicalToWorld(seed.position, cellWorldScale);
    visual.marker.material = markerMaterial(seed, materials);
    visual.influence.material = influenceMaterial(seed, materials);
  };

  const reconcile = (seeds: readonly DistrictSeed[]): void => {
    if (disposed) throw new Error('Cannot update a disposed seed layer.');
    const desiredIds = new Set<string>();
    for (const seed of seeds) {
      if (desiredIds.has(seed.id)) throw new Error(`Duplicate district seed ID ${seed.id}.`);
      desiredIds.add(seed.id);
      const visual = visuals.get(seed.id);
      if (visual === undefined) {
        const created = createVisual(seed);
        visuals.set(seed.id, created);
        updateVisual(created, seed);
      } else {
        updateVisual(visual, seed);
      }
    }
    for (const [id, visual] of visuals) {
      if (desiredIds.has(id)) continue;
      visual.root.dispose();
      visuals.delete(id);
    }
  };

  return {
    reconcile,
    dispose(): void {
      if (disposed) return;
      for (const visual of visuals.values()) visual.root.dispose();
      visuals.clear();
      disposed = true;
    },
  };
}
