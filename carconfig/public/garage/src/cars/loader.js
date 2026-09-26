// Downloading and parsing models: progress that works even when the server
// sends no length, cancellation when the visitor picks another car, and a
// small cache so going back to a car is instant. One broken file only ever
// fails its own car.
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import * as THREE from "three";
import { modelSource } from "../config.js";

/** Older exports describe materials as diffuse + glossiness; read the colour and texture, turn glossiness into roughness. */
function specGlossPlugin(parser) {
  const NAME = "KHR_materials_pbrSpecularGlossiness";
  return {
    name: NAME,
    extendMaterialParams(materialIndex, params) {
      const def = parser.json.materials?.[materialIndex];
      const ext = def?.extensions?.[NAME];
      if (!ext) return null;
      const d = ext.diffuseFactor ?? [1, 1, 1, 1];
      params.color = new THREE.Color().setRGB(d[0], d[1], d[2], THREE.LinearSRGBColorSpace);
      if (def.alphaMode === "BLEND") params.opacity = d[3];
      params.metalness = 0;
      params.roughness = 1 - (ext.glossinessFactor ?? 1);
      if (!ext.diffuseTexture) return Promise.resolve();
      return parser.assignTexture(params, "map", ext.diffuseTexture).then(() => {
        if (params.map) params.map.colorSpace = THREE.SRGBColorSpace;
      });
    },
  };
}

export class LoadError extends Error {
  constructor(message, { cause, url, status } = {}) {
    super(message, { cause });
    this.name = "LoadError";
    this.url = url;
    this.status = status;
  }
}

export class ModelLoader {
  constructor() {
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.loader.register(specGlossPlugin);
    this.source = modelSource();
  }

  urlFor(entry) {
    const file = entry.modelPath.replace(/\.glb$/, this.source.ext);
    return new URL(this.source.prefix + file, document.baseURI).href;
  }

  /**
   * Fetches and parses a model.
   * @param {object} entry catalogue entry
   * @param {{signal?: AbortSignal, onProgress?: (fraction: number|null) => void}} options
   */
  async load(entry, { signal, onProgress } = {}) {
    const url = this.urlFor(entry);
    let response;
    try {
      response = await fetch(url, { signal });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      throw new LoadError("The model could not be downloaded. Check the connection and try again.", { cause: err, url });
    }
    if (!response.ok) throw new LoadError(`The model file answered ${response.status}.`, { url, status: response.status });

    const header = Number(response.headers.get("content-length")) || 0;
    // Compressed responses report the compressed length; the catalogue's size is the better guess then.
    const encoded = /gzip|br|deflate|zstd/.test(response.headers.get("content-encoding") ?? "");
    const total = !encoded && header ? header : entry.bytes || header || 0;
    const chunks = [];
    let received = 0;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(total ? Math.min(received / total, 0.99) : null);
      }
    } else {
      chunks.push(new Uint8Array(await response.arrayBuffer()));
    }
    signal?.throwIfAborted?.();
    const buffer = new Uint8Array(received || chunks[0].byteLength);
    let offset = 0;
    for (const c of chunks) {
      buffer.set(c, offset);
      offset += c.byteLength;
    }

    const base = url.slice(0, url.lastIndexOf("/") + 1);
    try {
      const gltf = await this.loader.parseAsync(buffer.buffer, base);
      onProgress?.(1);
      return gltf;
    } catch (err) {
      throw new LoadError("The model file is damaged or in a form the viewer cannot read.", { cause: err, url });
    }
  }
}

/**
 * Keeps the last few prepared cars so switching back is instant, and frees
 * the GPU memory of older ones. The car on screen is never evicted.
 */
export class VehicleCache {
  constructor(limit = 3) {
    this.limit = limit;
    this.items = new Map();
  }
  get(id) {
    const v = this.items.get(id);
    if (v) {
      this.items.delete(id);
      this.items.set(id, v);
    }
    return v;
  }
  put(id, vehicle, keep) {
    this.items.set(id, vehicle);
    for (const [key, v] of this.items) {
      if (this.items.size <= this.limit) break;
      if (key === keep || key === id) continue;
      this.items.delete(key);
      v.dispose();
    }
  }
}
