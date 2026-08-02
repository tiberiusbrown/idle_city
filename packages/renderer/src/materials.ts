import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Scene } from '@babylonjs/core/scene';

export interface CityMaterials {
  readonly ground: PBRMaterial;
  readonly alternateGround: PBRMaterial;
  readonly home: PBRMaterial;
  readonly workplace: PBRMaterial;
  readonly window: PBRMaterial;
  readonly citizen: PBRMaterial;
  readonly citizenAccent: PBRMaterial;
  readonly constructionSurvey: PBRMaterial;
  readonly constructionBlueprint: PBRMaterial;
  readonly constructionFoundation: PBRMaterial;
  readonly constructionFrame: PBRMaterial;
  readonly constructionCompletion: PBRMaterial;
  readonly seedLiving: PBRMaterial;
  readonly seedWorking: PBRMaterial;
  readonly seedServices: PBRMaterial;
  readonly influenceLiving: PBRMaterial;
  readonly influenceWorking: PBRMaterial;
  readonly influenceServices: PBRMaterial;
  readonly placementValid: PBRMaterial;
  readonly placementInvalid: PBRMaterial;
}

function createMaterial(
  scene: Scene,
  name: string,
  color: Color3,
  emissive = 0,
  alpha = 1,
): PBRMaterial {
  const result = new PBRMaterial(name, scene);
  result.albedoColor = color;
  result.emissiveColor = color.scale(emissive);
  result.metallic = 0.2;
  result.roughness = 0.75;
  result.alpha = alpha;
  if (alpha < 1) result.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  return result;
}

export function createCityMaterials(scene: Scene): CityMaterials {
  const living = new Color3(0.26, 0.45, 0.86);
  const working = new Color3(0.59, 0.28, 0.8);
  const services = new Color3(0.95, 0.48, 0.26);
  const cyan = new Color3(0.33, 0.95, 0.82);
  return {
    ground: createMaterial(scene, 'ground-material', new Color3(0.035, 0.07, 0.11), 0.05),
    alternateGround: createMaterial(
      scene,
      'alternate-ground-material',
      new Color3(0.04, 0.095, 0.13),
      0.08,
    ),
    home: createMaterial(scene, 'home-material', living, 0.1),
    workplace: createMaterial(scene, 'workplace-material', working, 0.12),
    window: createMaterial(scene, 'window-material', cyan, 0.7),
    citizen: createMaterial(scene, 'citizen-material', new Color3(0.98, 0.65, 0.27), 0.18),
    citizenAccent: createMaterial(scene, 'citizen-accent', cyan, 0.3),
    constructionSurvey: createMaterial(scene, 'construction-survey-material', cyan, 0.35, 0.32),
    constructionBlueprint: createMaterial(scene, 'construction-blueprint-material', cyan, 0.5, 0.5),
    constructionFoundation: createMaterial(
      scene,
      'construction-foundation-material',
      new Color3(0.9, 0.68, 0.22),
      0.35,
      0.82,
    ),
    constructionFrame: createMaterial(
      scene,
      'construction-frame-material',
      new Color3(0.98, 0.42, 0.2),
      0.45,
      0.7,
    ),
    constructionCompletion: createMaterial(
      scene,
      'construction-completion-material',
      new Color3(0.4, 0.92, 0.72),
      0.5,
      0.62,
    ),
    seedLiving: createMaterial(scene, 'seed-living-material', living, 0.45),
    seedWorking: createMaterial(scene, 'seed-working-material', working, 0.45),
    seedServices: createMaterial(scene, 'seed-services-material', services, 0.45),
    influenceLiving: createMaterial(scene, 'seed-influence-living-material', living, 0.25, 0.2),
    influenceWorking: createMaterial(scene, 'seed-influence-working-material', working, 0.25, 0.2),
    influenceServices: createMaterial(
      scene,
      'seed-influence-services-material',
      services,
      0.25,
      0.2,
    ),
    placementValid: createMaterial(
      scene,
      'placement-valid-material',
      new Color3(0.26, 0.95, 0.66),
      0.6,
      0.5,
    ),
    placementInvalid: createMaterial(
      scene,
      'placement-invalid-material',
      new Color3(0.98, 0.3, 0.32),
      0.6,
      0.5,
    ),
  };
}
