import * as THREE from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three-stdlib";

/**
 * KHR_materials_pbrSpecularGlossiness, read the simple way.
 *
 * Older exports describe materials by diffuse colour and glossiness, a format
 * three.js stopped reading. Without this, such a model's every surface loads
 * as bare white metal. Models copied into the site are converted when they
 * are fetched; models linked to the mirror arrive as they are, so the viewer
 * reads the diffuse colour and texture, and turns glossiness into roughness,
 * on a non-metallic surface. The specular colour is left out; at a
 * configurator's viewing distance the difference is small next to losing
 * every colour.
 */
const NAME = "KHR_materials_pbrSpecularGlossiness";

interface SpecGloss {
  diffuseFactor?: [number, number, number, number];
  diffuseTexture?: { index: number; texCoord?: number };
  glossinessFactor?: number;
}

export function specGlossPlugin(parser: GLTFParser): GLTFLoaderPlugin & { name: string } {
  return {
    name: NAME,
    extendMaterialParams(materialIndex, params) {
      const def = (parser.json as { materials?: { extensions?: Record<string, unknown>; alphaMode?: string }[] }).materials?.[
        materialIndex
      ];
      const ext = def?.extensions?.[NAME] as SpecGloss | undefined;
      if (!ext) return null;
      const d = ext.diffuseFactor ?? [1, 1, 1, 1];
      params.color = new THREE.Color().setRGB(d[0], d[1], d[2], THREE.LinearSRGBColorSpace);
      if (def?.alphaMode === "BLEND") params.opacity = d[3];
      params.metalness = 0;
      params.roughness = 1 - (ext.glossinessFactor ?? 1);
      const pending: Promise<unknown>[] = [];
      if (ext.diffuseTexture) pending.push(parser.assignTexture(params, "map", ext.diffuseTexture));
      return Promise.all(pending).then(() => {
        const map = params.map as THREE.Texture | undefined;
        if (map) map.colorSpace = THREE.SRGBColorSpace;
      });
    },
  };
}
