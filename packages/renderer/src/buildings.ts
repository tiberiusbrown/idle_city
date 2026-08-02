import type { Building } from '@idle-city/simulation';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { footprintToWorldCenter, footprintToWorldSize } from './coordinates';
import type { CityMaterials } from './materials';

export interface BuildingLayer {
  reconcile(buildings: readonly Building[]): void;
  dispose(): void;
}

interface BuildingVisual {
  readonly root: TransformNode;
  readonly body: ReturnType<typeof CreateBox>;
  readonly beacon: ReturnType<typeof CreateBox>;
}

export function buildingVisualHeight(type: Building['type']): number {
  return type === 'home' ? 0.9 : type === 'workplace' ? 1.8 : 1.35;
}

function setBoxDimensions(
  mesh: ReturnType<typeof CreateBox>,
  width: number,
  height: number,
  depth: number,
): void {
  mesh.scaling = mesh.scaling.copyFromFloats(width, height, depth);
  mesh.position.y = height / 2;
}

function materialForBuilding(type: Building['type'], materials: CityMaterials) {
  return type === 'home'
    ? materials.home
    : type === 'workplace'
      ? materials.workplace
      : materials.service;
}

export function createBuildingLayer(
  scene: Scene,
  cellWorldScale: number,
  materials: CityMaterials,
): BuildingLayer {
  const visuals = new Map<string, BuildingVisual>();
  let disposed = false;

  const createVisual = (building: Building): BuildingVisual => {
    const root = new TransformNode(`building-${building.id}`, scene);
    const body = CreateBox(`${building.id}-body`, { size: 1 }, scene);
    body.parent = root;
    body.material = materialForBuilding(building.type, materials);
    body.isPickable = false;
    const beacon = CreateBox(`${building.id}-beacon`, { size: 0.2 }, scene);
    beacon.parent = root;
    beacon.material = materials.window;
    beacon.isPickable = false;
    return { root, body, beacon };
  };

  const updateVisual = (visual: BuildingVisual, building: Building): void => {
    visual.root.position = footprintToWorldCenter(building.footprint, cellWorldScale);
    const size = footprintToWorldSize(building.footprint, cellWorldScale);
    const height = buildingVisualHeight(building.type);
    setBoxDimensions(visual.body, size.width, height, size.depth);
    visual.body.material = materialForBuilding(building.type, materials);
    visual.beacon.position.y = height + 0.15;
  };

  const reconcile = (buildings: readonly Building[]): void => {
    if (disposed) throw new Error('Cannot update a disposed building layer.');
    const desiredIds = new Set<string>();
    for (const building of buildings) {
      if (desiredIds.has(building.id)) throw new Error(`Duplicate building ID ${building.id}.`);
      desiredIds.add(building.id);
      const visual = visuals.get(building.id);
      if (visual === undefined) {
        const created = createVisual(building);
        visuals.set(building.id, created);
        updateVisual(created, building);
      } else {
        updateVisual(visual, building);
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
