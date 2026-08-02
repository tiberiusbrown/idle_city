import {
  CONSTRUCTION_PHASE_ORDER,
  type ConstructionPhase,
  type ConstructionProject,
} from '@idle-city/simulation';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import { footprintToWorldCenter, footprintToWorldSize } from './coordinates';
import { buildingVisualHeight } from './buildings';
import type { CityMaterials } from './materials';

export interface ConstructionLayer {
  reconcile(projects: readonly ConstructionProject[]): void;
  dispose(): void;
}

interface ConstructionVisual {
  readonly root: TransformNode;
  readonly phaseMeshes: Record<ConstructionPhase, ReturnType<typeof CreateBox>>;
}

const phaseHeights: Readonly<Record<ConstructionPhase, number>> = {
  survey: 0.04,
  blueprint: 1,
  foundation: 0.12,
  frame: 1,
  completion: 1,
};

function phaseMaterial(phase: ConstructionPhase, materials: CityMaterials) {
  switch (phase) {
    case 'survey':
      return materials.constructionSurvey;
    case 'blueprint':
      return materials.constructionBlueprint;
    case 'foundation':
      return materials.constructionFoundation;
    case 'frame':
      return materials.constructionFrame;
    case 'completion':
      return materials.constructionCompletion;
  }
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

export function createConstructionLayer(
  scene: Scene,
  cellWorldScale: number,
  materials: CityMaterials,
): ConstructionLayer {
  const visuals = new Map<string, ConstructionVisual>();
  let disposed = false;

  const createVisual = (project: ConstructionProject): ConstructionVisual => {
    const root = new TransformNode(`construction-${project.id}`, scene);
    const phaseMeshes = {} as Record<ConstructionPhase, ReturnType<typeof CreateBox>>;
    for (const phase of CONSTRUCTION_PHASE_ORDER) {
      const mesh = CreateBox(`${project.id}-${phase}`, { size: 1 }, scene);
      mesh.parent = root;
      const phaseVisualMaterial = phaseMaterial(phase, materials);
      mesh.material = phaseVisualMaterial;
      mesh.isPickable = false;
      mesh.isVisible = false;
      if (phase === 'blueprint' || phase === 'frame') {
        phaseVisualMaterial.wireframe = true;
      }
      phaseMeshes[phase] = mesh;
    }
    return { root, phaseMeshes };
  };

  const updateVisual = (visual: ConstructionVisual, project: ConstructionProject): void => {
    visual.root.position = footprintToWorldCenter(project.footprint, cellWorldScale);
    const size = footprintToWorldSize(project.footprint, cellWorldScale);
    const finalHeight = buildingVisualHeight(project.buildingType);
    for (const phase of CONSTRUCTION_PHASE_ORDER) {
      const mesh = visual.phaseMeshes[phase];
      const height =
        phase === 'blueprint' || phase === 'frame' || phase === 'completion'
          ? finalHeight
          : phaseHeights[phase];
      setBoxDimensions(mesh, size.width, height, size.depth);
      mesh.isVisible = phase === project.phase;
    }
  };

  const reconcile = (projects: readonly ConstructionProject[]): void => {
    if (disposed) throw new Error('Cannot update a disposed construction layer.');
    const desiredIds = new Set<string>();
    for (const project of projects) {
      if (desiredIds.has(project.id))
        throw new Error(`Duplicate construction project ID ${project.id}.`);
      desiredIds.add(project.id);
      const visual = visuals.get(project.id);
      if (visual === undefined) {
        const created = createVisual(project);
        visuals.set(project.id, created);
        updateVisual(created, project);
      } else {
        updateVisual(visual, project);
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
