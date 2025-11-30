/**
 * .cryo XML Parser
 * Converts .cryo XML files to CryoDocument AST
 */

import { XMLParser } from 'fast-xml-parser';
import {
  CryoDocument,
  Meta,
  Imports,
  AssetType,
  Scene,
  Environment,
  Entity,
  Transform,
  Component,
  Script,
  Prefab,
  Vec3,
  Vec4,
  Color,
  MeshComponent,
  LightComponent,
  CameraComponent,
  ColliderComponent,
  RigidbodyComponent,
  AudioSourceComponent,
  MaterialComponent,
  CustomComponent,
  Skybox,
  Lighting,
  Fog,
  Physics,
} from '../types/cryo';

export interface ParseResult {
  document: CryoDocument;
  errors: ParseError[];
  warnings: ParseWarning[];
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
}

export interface ParseWarning {
  message: string;
  line?: number;
}

/**
 * Parse a .cryo XML string into a CryoDocument
 */
export function parse(xml: string): ParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseWarning[] = [];

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    parseAttributeValue: true,
    trimValues: true,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    errors.push({ message: `XML parse error: ${err}` });
    return { document: createEmptyDocument(), errors, warnings };
  }

  const cryoElement = parsed['cryo'] as Record<string, unknown>;
  if (!cryoElement) {
    errors.push({ message: 'Missing root <cryo> element' });
    return { document: createEmptyDocument(), errors, warnings };
  }

  const version = cryoElement['@_version'] as string;
  if (!version) {
    errors.push({ message: 'Missing version attribute on <cryo> element' });
  }

  const document: CryoDocument = {
    version: version || '1.0',
    meta: parseMeta(cryoElement['meta']),
    imports: parseImports(cryoElement['imports']),
  };

  if (cryoElement['scene']) {
    document.scene = parseScene(cryoElement['scene'], errors, warnings);
  }

  if (cryoElement['prefab']) {
    document.prefab = parsePrefab(cryoElement['prefab'], errors, warnings);
  }

  return { document, errors, warnings };
}

function createEmptyDocument(): CryoDocument {
  return { version: '1.0' };
}

// ============================================================================
// Meta Parsing
// ============================================================================

function parseMeta(meta: unknown): Meta | undefined {
  if (!meta || typeof meta !== 'object') return undefined;

  const m = meta as Record<string, unknown>;
  const result: Meta = {};

  if (m['name']) result.name = String(m['name']);
  if (m['description']) result.description = String(m['description']);
  if (m['author']) result.author = String(m['author']);
  if (m['created']) result.created = String(m['created']);
  if (m['tags']) {
    const tags = m['tags'] as Record<string, unknown>;
    result.tags = parseStringArray(tags['tag']);
  }

  return result;
}

// ============================================================================
// Imports Parsing
// ============================================================================

function parseImports(imports: unknown): Imports | undefined {
  if (!imports || typeof imports !== 'object') return undefined;

  const i = imports as Record<string, unknown>;
  const result: Imports = {
    imports: [],
    assets: [],
    luaModules: [],
  };

  // Parse imports
  if (i['import']) {
    const importElements = ensureArray(i['import']);
    for (const imp of importElements) {
      const impObj = imp as Record<string, unknown>;
      result.imports.push({
        src: String(impObj['@_src'] || ''),
        as: impObj['@_as'] ? String(impObj['@_as']) : undefined,
      });
    }
  }

  // Parse assets
  if (i['asset']) {
    const assetElements = ensureArray(i['asset']);
    for (const asset of assetElements) {
      const assetObj = asset as Record<string, unknown>;
      result.assets.push({
        id: String(assetObj['@_id'] || ''),
        type: String(assetObj['@_type'] || 'gltf') as AssetType,
        src: String(assetObj['@_src'] || ''),
      });
    }
  }

  // Parse Lua modules
  if (i['lua-module']) {
    const luaElements = ensureArray(i['lua-module']);
    for (const lua of luaElements) {
      const luaObj = lua as Record<string, unknown>;
      result.luaModules.push({
        id: String(luaObj['@_id'] || ''),
        src: String(luaObj['@_src'] || ''),
      });
    }
  }

  return result;
}

// ============================================================================
// Scene Parsing
// ============================================================================

function parseScene(
  scene: unknown,
  errors: ParseError[],
  warnings: ParseWarning[]
): Scene {
  const s = scene as Record<string, unknown>;

  const result: Scene = {
    id: String(s['@_id'] || 'unnamed-scene'),
    name: s['@_name'] ? String(s['@_name']) : undefined,
    entities: [],
  };

  if (s['environment']) {
    result.environment = parseEnvironment(s['environment']);
  }

  if (s['entities']) {
    const entitiesObj = s['entities'] as Record<string, unknown>;
    if (entitiesObj['entity']) {
      const entityElements = ensureArray(entitiesObj['entity']);
      for (const entity of entityElements) {
        result.entities.push(parseEntity(entity, errors, warnings));
      }
    }
  }

  return result;
}

// ============================================================================
// Environment Parsing
// ============================================================================

function parseEnvironment(env: unknown): Environment {
  const e = env as Record<string, unknown>;
  const result: Environment = {};

  if (e['skybox']) {
    result.skybox = parseSkybox(e['skybox']);
  }

  if (e['lighting']) {
    result.lighting = parseLighting(e['lighting']);
  }

  if (e['fog']) {
    result.fog = parseFog(e['fog']);
  }

  if (e['physics']) {
    result.physics = parsePhysics(e['physics']);
  }

  return result;
}

function parseSkybox(skybox: unknown): Skybox {
  const s = skybox as Record<string, unknown>;
  return {
    type: (String(s['@_type'] || 'procedural') as Skybox['type']),
    src: s['@_src'] ? String(s['@_src']) : undefined,
    timeOfDay: s['@_time-of-day'] ? String(s['@_time-of-day']) : undefined,
  };
}

function parseLighting(lighting: unknown): Lighting {
  const l = lighting as Record<string, unknown>;
  const result: Lighting = {
    directional: [],
  };

  if (l['ambient']) {
    const a = l['ambient'] as Record<string, unknown>;
    result.ambient = {
      color: parseColor(String(a['@_color'] || '#ffffff')),
      intensity: parseFloat(String(a['@_intensity'] || '1')),
    };
  }

  if (l['directional']) {
    const dirElements = ensureArray(l['directional']);
    for (const dir of dirElements) {
      const d = dir as Record<string, unknown>;
      result.directional.push({
        id: d['@_id'] ? String(d['@_id']) : undefined,
        color: parseColor(String(d['@_color'] || '#ffffff')),
        intensity: parseFloat(String(d['@_intensity'] || '1')),
        direction: parseVec3(String(d['@_direction'] || '0, -1, 0')),
        castShadows: parseBool(d['@_cast-shadows']),
      });
    }
  }

  return result;
}

function parseFog(fog: unknown): Fog {
  const f = fog as Record<string, unknown>;
  return {
    enabled: parseBool(f['@_enabled'], true),
    color: parseColor(String(f['@_color'] || '#ffffff')),
    density: parseFloat(String(f['@_density'] || '0.01')),
  };
}

function parsePhysics(physics: unknown): Physics {
  const p = physics as Record<string, unknown>;
  return {
    gravity: parseVec3(String(p['@_gravity'] || '0, -9.81, 0')),
  };
}

// ============================================================================
// Entity Parsing
// ============================================================================

function parseEntity(
  entity: unknown,
  errors: ParseError[],
  warnings: ParseWarning[]
): Entity {
  const e = entity as Record<string, unknown>;

  const result: Entity = {
    id: String(e['@_id'] || 'unnamed-entity'),
    name: e['@_name'] ? String(e['@_name']) : undefined,
    prefab: e['@_prefab'] ? String(e['@_prefab']) : undefined,
    enabled: parseBool(e['@_enabled'], true),
    transform: parseTransform(e['transform']),
    components: [],
    children: [],
  };

  // Parse components
  if (e['components']) {
    const componentsObj = e['components'] as Record<string, unknown>;
    result.components = parseComponents(componentsObj);
  }

  // Parse children
  if (e['children']) {
    const childrenObj = e['children'] as Record<string, unknown>;
    if (childrenObj['entity']) {
      const childElements = ensureArray(childrenObj['entity']);
      for (const child of childElements) {
        result.children.push(parseEntity(child, errors, warnings));
      }
    }
  }

  // Parse script
  if (e['script']) {
    result.script = parseScript(e['script']);
  }

  return result;
}

// ============================================================================
// Transform Parsing
// ============================================================================

function parseTransform(transform: unknown): Transform {
  if (!transform || typeof transform !== 'object') {
    return {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      scale: { x: 1, y: 1, z: 1 },
    };
  }

  const t = transform as Record<string, unknown>;
  const positionStr = String(t['@_position'] || '0, 0, 0');
  const rotationStr = String(t['@_rotation'] || '0, 0, 0');
  const scaleStr = String(t['@_scale'] || '1, 1, 1');

  return {
    position: parseVec3(positionStr),
    rotation: parseRotation(rotationStr),
    scale: parseVec3(scaleStr),
  };
}

// ============================================================================
// Component Parsing
// ============================================================================

function parseComponents(components: Record<string, unknown>): Component[] {
  const result: Component[] = [];

  // Mesh
  if (components['mesh']) {
    const meshElements = ensureArray(components['mesh']);
    for (const mesh of meshElements) {
      result.push(parseMeshComponent(mesh));
    }
  }

  // Material
  if (components['material']) {
    const materialElements = ensureArray(components['material']);
    for (const material of materialElements) {
      result.push(parseMaterialComponent(material));
    }
  }

  // Light
  if (components['light']) {
    const lightElements = ensureArray(components['light']);
    for (const light of lightElements) {
      result.push(parseLightComponent(light));
    }
  }

  // Camera
  if (components['camera']) {
    const cameraElements = ensureArray(components['camera']);
    for (const camera of cameraElements) {
      result.push(parseCameraComponent(camera));
    }
  }

  // Collider
  if (components['collider']) {
    const colliderElements = ensureArray(components['collider']);
    for (const collider of colliderElements) {
      result.push(parseColliderComponent(collider));
    }
  }

  // Rigidbody
  if (components['rigidbody']) {
    const rigidbodyElements = ensureArray(components['rigidbody']);
    for (const rigidbody of rigidbodyElements) {
      result.push(parseRigidbodyComponent(rigidbody));
    }
  }

  // Audio Source
  if (components['audio-source']) {
    const audioElements = ensureArray(components['audio-source']);
    for (const audio of audioElements) {
      result.push(parseAudioSourceComponent(audio));
    }
  }

  // Custom components
  if (components['component']) {
    const customElements = ensureArray(components['component']);
    for (const custom of customElements) {
      result.push(parseCustomComponent(custom));
    }
  }

  return result;
}

function parseMeshComponent(mesh: unknown): MeshComponent {
  const m = mesh as Record<string, unknown>;
  return {
    type: 'mesh',
    asset: String(m['@_asset'] || ''),
    castShadows: parseBool(m['@_cast-shadows'], true),
    receiveShadows: parseBool(m['@_receive-shadows'], true),
  };
}

function parseMaterialComponent(material: unknown): MaterialComponent {
  const m = material as Record<string, unknown>;
  const result: MaterialComponent = {
    type: 'material',
    shader: String(m['@_shader'] || 'pbr'),
    asset: m['@_asset'] ? String(m['@_asset']) : undefined,
    properties: {},
  };

  if (m['property']) {
    const properties = ensureArray(m['property']);
    for (const prop of properties) {
      const p = prop as Record<string, unknown>;
      const name = String(p['@_name'] || '');
      const value = String(p['@_value'] || '');
      result.properties[name] = value;
    }
  }

  return result;
}

function parseLightComponent(light: unknown): LightComponent {
  const l = light as Record<string, unknown>;
  return {
    type: 'light',
    lightType: String(l['@_type'] || 'point') as LightComponent['lightType'],
    color: parseColor(String(l['@_color'] || '#ffffff')),
    intensity: parseFloat(String(l['@_intensity'] || '1')),
    range: l['@_range'] ? parseFloat(String(l['@_range'])) : undefined,
    castShadows: parseBool(l['@_cast-shadows']),
  };
}

function parseCameraComponent(camera: unknown): CameraComponent {
  const c = camera as Record<string, unknown>;
  return {
    type: 'camera',
    fov: parseFloat(String(c['@_fov'] || '60')),
    near: parseFloat(String(c['@_near'] || '0.1')),
    far: parseFloat(String(c['@_far'] || '1000')),
    projection: String(c['@_projection'] || 'perspective') as 'perspective' | 'orthographic',
  };
}

function parseColliderComponent(collider: unknown): ColliderComponent {
  const c = collider as Record<string, unknown>;
  const result: ColliderComponent = {
    type: 'collider',
    colliderType: String(c['@_type'] || 'box') as ColliderComponent['colliderType'],
    trigger: parseBool(c['@_trigger']),
  };

  if (c['@_size']) {
    result.size = parseVec3(String(c['@_size']));
  }
  if (c['@_radius']) {
    result.radius = parseFloat(String(c['@_radius']));
  }
  if (c['@_height']) {
    result.height = parseFloat(String(c['@_height']));
  }
  if (c['@_asset']) {
    result.asset = String(c['@_asset']);
  }

  return result;
}

function parseRigidbodyComponent(rigidbody: unknown): RigidbodyComponent {
  const r = rigidbody as Record<string, unknown>;
  return {
    type: 'rigidbody',
    mass: parseFloat(String(r['@_mass'] || '1')),
    drag: parseFloat(String(r['@_drag'] || '0')),
    angularDrag: parseFloat(String(r['@_angular-drag'] || '0.05')),
    useGravity: parseBool(r['@_use-gravity'], true),
    kinematic: parseBool(r['@_kinematic']),
  };
}

function parseAudioSourceComponent(audio: unknown): AudioSourceComponent {
  const a = audio as Record<string, unknown>;
  return {
    type: 'audio-source',
    asset: String(a['@_asset'] || ''),
    volume: parseFloat(String(a['@_volume'] || '1')),
    loop: parseBool(a['@_loop']),
    spatial: parseBool(a['@_spatial'], true),
    playOnStart: parseBool(a['@_play-on-start']),
  };
}

function parseCustomComponent(custom: unknown): CustomComponent {
  const c = custom as Record<string, unknown>;
  const result: CustomComponent = {
    type: 'custom',
    componentType: String(c['@_type'] || 'unknown'),
    properties: {},
  };

  if (c['property']) {
    const properties = ensureArray(c['property']);
    for (const prop of properties) {
      const p = prop as Record<string, unknown>;
      const name = String(p['@_name'] || '');
      const value = String(p['@_value'] || '');
      result.properties[name] = value;
    }
  }

  return result;
}

// ============================================================================
// Script Parsing
// ============================================================================

function parseScript(script: unknown): Script {
  const s = script as Record<string, unknown>;

  if (s['@_src']) {
    return { src: String(s['@_src']) };
  }

  // Check for CDATA or text content
  const cdata = s['#cdata'];
  const text = s['#text'];

  if (cdata) {
    return { inline: String(cdata) };
  }

  if (text) {
    return { inline: String(text) };
  }

  return {};
}

// ============================================================================
// Prefab Parsing
// ============================================================================

function parsePrefab(
  prefab: unknown,
  errors: ParseError[],
  warnings: ParseWarning[]
): Prefab {
  const p = prefab as Record<string, unknown>;

  const result: Prefab = {
    id: String(p['@_id'] || 'unnamed-prefab'),
    name: p['@_name'] ? String(p['@_name']) : undefined,
    transform: parseTransform(p['transform']),
    components: [],
    children: [],
  };

  if (p['components']) {
    result.components = parseComponents(p['components'] as Record<string, unknown>);
  }

  if (p['children']) {
    const childrenObj = p['children'] as Record<string, unknown>;
    if (childrenObj['entity']) {
      const childElements = ensureArray(childrenObj['entity']);
      for (const child of childElements) {
        result.children.push(parseEntity(child, errors, warnings));
      }
    }
  }

  if (p['script']) {
    result.script = parseScript(p['script']);
  }

  return result;
}

// ============================================================================
// Utility Functions
// ============================================================================

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  const arr = ensureArray(value);
  return arr.map((v) => String(v));
}

function parseBool(value: unknown, defaultValue: boolean = false): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true';
  }
  return defaultValue;
}

function parseVec3(str: string): Vec3 {
  const parts = str.split(',').map((s) => parseFloat(s.trim()));
  return {
    x: parts[0] || 0,
    y: parts[1] || 0,
    z: parts[2] || 0,
  };
}

function parseRotation(str: string): Vec4 {
  const parts = str.split(',').map((s) => parseFloat(s.trim()));

  // If 4 components, assume quaternion
  if (parts.length >= 4) {
    return {
      x: parts[0] || 0,
      y: parts[1] || 0,
      z: parts[2] || 0,
      w: parts[3] || 1,
    };
  }

  // Otherwise, convert euler angles (degrees) to quaternion
  const pitch = (parts[0] || 0) * (Math.PI / 180);
  const yaw = (parts[1] || 0) * (Math.PI / 180);
  const roll = (parts[2] || 0) * (Math.PI / 180);

  return eulerToQuaternion(pitch, yaw, roll);
}

function eulerToQuaternion(pitch: number, yaw: number, roll: number): Vec4 {
  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
    w: cr * cp * cy + sr * sp * sy,
  };
}

function parseColor(str: string): Color {
  // Handle hex color
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    if (hex.length === 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: 1,
      };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16) / 255,
        g: parseInt(hex.slice(2, 4), 16) / 255,
        b: parseInt(hex.slice(4, 6), 16) / 255,
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }

  // Handle comma-separated values
  const parts = str.split(',').map((s) => parseFloat(s.trim()));
  return {
    r: parts[0] || 0,
    g: parts[1] || 0,
    b: parts[2] || 0,
    a: parts[3] !== undefined ? parts[3] : 1,
  };
}
