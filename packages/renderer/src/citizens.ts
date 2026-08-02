import type { ChunkCoordinate } from '@idle-city/shared';
import { chunkCoordinateForPosition, chunkKey } from '@idle-city/simulation';
import type { CitizenSnapshot } from '@idle-city/simulation';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { interpolateLogicalPosition, logicalToWorld } from './coordinates';
import type { CityMaterials } from './materials';

export interface CitizenLayer {
  reconcile(
    citizens: readonly CitizenSnapshot[],
    interpolation: number,
    renderedChunks: readonly ChunkCoordinate[],
    chunkSize: number,
  ): void;
  getVisibleCitizenCount(): number;
  getRenderedCitizenCount(): number;
  dispose(): void;
}

interface CitizenVisual {
  readonly root: TransformNode;
  readonly body: ReturnType<typeof CreateBox>;
}

export function createCitizenLayer(
  scene: Scene,
  cellWorldScale: number,
  materials: CityMaterials,
): CitizenLayer {
  const visuals = new Map<string, CitizenVisual>();
  let visibleCitizenCount = 0;
  let disposed = false;

  const createVisual = (citizen: CitizenSnapshot): CitizenVisual => {
    const root = new TransformNode(`render-${citizen.id}`, scene);
    const body = CreateBox(`${citizen.id}-body`, { width: 0.22, height: 0.38, depth: 0.18 }, scene);
    body.parent = root;
    body.position.y = 0.3;
    body.material = materials.citizen;
    body.isPickable = false;
    const head = CreateBox(`${citizen.id}-head`, { size: 0.18 }, scene);
    head.parent = root;
    head.position.y = 0.58;
    head.material = materials.citizenAccent;
    head.isPickable = false;
    return { root, body };
  };

  const updateVisual = (visual: CitizenVisual, citizen: CitizenSnapshot, interpolation: number) => {
    const logicalPosition = interpolateLogicalPosition(
      citizen.previousPosition,
      citizen.position,
      interpolation,
    );
    visual.root.position = logicalToWorld(logicalPosition, cellWorldScale);
    visual.root.position.y = 0.04;
    const constructionAssigned =
      citizen.activity === 'commuting-to-construction' || citizen.activity === 'constructing';
    visual.body.material = constructionAssigned ? materials.constructionCitizen : materials.citizen;
  };

  const reconcile = (
    citizens: readonly CitizenSnapshot[],
    interpolation: number,
    renderedChunks: readonly ChunkCoordinate[],
    chunkSize: number,
  ): void => {
    if (disposed) throw new Error('Cannot update a disposed citizen layer.');
    const renderedChunkKeys = new Set(renderedChunks.map(chunkKey));
    const seenIds = new Set<string>();
    const desiredVisibleIds = new Set<string>();
    let nextVisibleCitizenCount = 0;
    for (const citizen of citizens) {
      if (seenIds.has(citizen.id)) throw new Error(`Duplicate citizen ID ${citizen.id}.`);
      seenIds.add(citizen.id);
      const currentChunk = chunkKey(chunkCoordinateForPosition(citizen.position, chunkSize));
      const previousChunk = chunkKey(
        chunkCoordinateForPosition(citizen.previousPosition, chunkSize),
      );
      if (!renderedChunkKeys.has(currentChunk) && !renderedChunkKeys.has(previousChunk)) continue;
      nextVisibleCitizenCount += 1;
      desiredVisibleIds.add(citizen.id);
      const visual = visuals.get(citizen.id);
      if (visual === undefined) {
        const created = createVisual(citizen);
        visuals.set(citizen.id, created);
        updateVisual(created, citizen, interpolation);
      } else {
        updateVisual(visual, citizen, interpolation);
      }
    }
    for (const [id, visual] of visuals) {
      if (desiredVisibleIds.has(id)) continue;
      visual.root.dispose();
      visuals.delete(id);
    }
    visibleCitizenCount = nextVisibleCitizenCount;
  };

  return {
    reconcile,
    getVisibleCitizenCount(): number {
      return visibleCitizenCount;
    },
    getRenderedCitizenCount(): number {
      return visuals.size;
    },
    dispose(): void {
      if (disposed) return;
      for (const visual of visuals.values()) visual.root.dispose();
      visuals.clear();
      visibleCitizenCount = 0;
      disposed = true;
    },
  };
}
