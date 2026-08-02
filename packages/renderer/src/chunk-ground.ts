import type { ChunkCoordinate } from '@idle-city/shared';
import { chunkCoordinateForPosition, chunkKey } from '@idle-city/simulation';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { SimulationSnapshot } from '@idle-city/simulation';
import { chunkToWorldCenter } from './coordinates';
import type { CityMaterials } from './materials';

export interface ChunkGroundOptions {
  readonly visibleChunks?: readonly ChunkCoordinate[];
  readonly visibleChunkRadius: number;
  readonly cellWorldScale: number;
}

export interface ChunkGroundLayer {
  reconcile(snapshot: SimulationSnapshot): void;
  setVisibleChunks(chunks: readonly ChunkCoordinate[]): void;
  getVisibleChunkCount(): number;
  getRenderedChunkCount(): number;
  getRebuildCount(): number;
  dispose(): void;
}

interface GroundChunk {
  readonly key: string;
  readonly revision: number;
  readonly mesh: ReturnType<typeof CreateBox>;
}

function validateVisibleRadius(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `visibleChunkRadius must be a non-negative safe integer; received ${String(value)}.`,
    );
  }
  return value;
}

export function createChunkGroundLayer(
  scene: Scene,
  camera: ArcRotateCamera,
  materials: CityMaterials,
  options: ChunkGroundOptions,
): ChunkGroundLayer {
  const visibleRadius = validateVisibleRadius(options.visibleChunkRadius);
  const groundChunks = new Map<string, GroundChunk>();
  let explicitVisibleChunks = options.visibleChunks?.map((chunk) => ({ ...chunk }));
  let chunkRebuilds = 0;
  let disposed = false;

  const createGroundChunk = (
    snapshot: SimulationSnapshot,
    summary: SimulationSnapshot['activeChunks'][number],
  ): GroundChunk => {
    const mesh = CreateBox(
      `ground-chunk-${summary.key}`,
      {
        width: snapshot.chunkSize * options.cellWorldScale,
        depth: snapshot.chunkSize * options.cellWorldScale,
        height: 0.08,
      },
      scene,
    );
    mesh.position = chunkToWorldCenter(summary.chunk, snapshot.chunkSize, options.cellWorldScale);
    mesh.material =
      (summary.chunk.x + summary.chunk.y) % 2 === 0 ? materials.ground : materials.alternateGround;
    mesh.isPickable = true;
    chunkRebuilds += 1;
    return { key: summary.key, revision: summary.occupancyRevision, mesh };
  };

  const visibleChunkCoordinates = (snapshot: SimulationSnapshot): readonly ChunkCoordinate[] => {
    if (explicitVisibleChunks !== undefined) {
      const activeKeys = new Set(snapshot.activeChunks.map((summary) => summary.key));
      return explicitVisibleChunks
        .filter((chunk) => activeKeys.has(chunkKey(chunk)))
        .map((chunk) => ({ ...chunk }));
    }
    const targetLogical = {
      x: Math.floor(camera.target.x / options.cellWorldScale),
      y: Math.floor(camera.target.z / options.cellWorldScale),
    };
    const center = chunkCoordinateForPosition(targetLogical, snapshot.chunkSize);
    return snapshot.activeChunks
      .map((summary) => summary.chunk)
      .filter(
        (chunk) =>
          Math.abs(chunk.x - center.x) <= visibleRadius &&
          Math.abs(chunk.y - center.y) <= visibleRadius,
      )
      .map((chunk) => ({ ...chunk }));
  };

  const reconcile = (snapshot: SimulationSnapshot): void => {
    if (disposed) throw new Error('Cannot update a disposed chunk ground layer.');
    const visible = visibleChunkCoordinates(snapshot);
    const summariesByKey = new Map(snapshot.activeChunks.map((summary) => [summary.key, summary]));
    const desiredKeys = new Set(visible.map(chunkKey));
    for (const [key, ground] of groundChunks) {
      if (desiredKeys.has(key)) continue;
      ground.mesh.dispose();
      groundChunks.delete(key);
    }
    for (const chunk of visible) {
      const key = chunkKey(chunk);
      const summary = summariesByKey.get(key);
      if (summary === undefined) continue;
      const current = groundChunks.get(key);
      if (current?.revision === summary.occupancyRevision) continue;
      current?.mesh.dispose();
      groundChunks.set(key, createGroundChunk(snapshot, summary));
    }
  };

  return {
    reconcile,
    setVisibleChunks(chunks: readonly ChunkCoordinate[]): void {
      if (disposed) throw new Error('Cannot change visibility on a disposed chunk ground layer.');
      explicitVisibleChunks = chunks.map((chunk) => ({ ...chunk }));
    },
    getVisibleChunkCount(): number {
      return explicitVisibleChunks?.length ?? groundChunks.size;
    },
    getRenderedChunkCount(): number {
      return groundChunks.size;
    },
    getRebuildCount(): number {
      return chunkRebuilds;
    },
    dispose(): void {
      if (disposed) return;
      for (const ground of groundChunks.values()) ground.mesh.dispose();
      groundChunks.clear();
      explicitVisibleChunks = undefined;
      disposed = true;
    },
  };
}
