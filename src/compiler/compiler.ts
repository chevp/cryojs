/**
 * .cryo to Protocol Buffer Compiler
 * Converts CryoDocument AST to cryo-protocol messages
 */

import {
  CryoDocument,
  Entity,
  Component,
  Transform,
  EntityType,
  ComponentType,
  MeshComponent,
  LightComponent,
  CameraComponent,
  ColliderComponent,
  RigidbodyComponent,
  AudioSourceComponent,
  CustomComponent,
} from '../types/cryo';

// ============================================================================
// Protocol Buffer Message Interfaces
// ============================================================================

export interface CryoVec3 {
  x: number;
  y: number;
  z: number;
}

export interface CryoVec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface CryoColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface CryoTransform {
  position: CryoVec3;
  rotation: CryoVec4;
  scale: CryoVec3;
}

export interface EntityProto {
  entity_id: string;
  name: string;
  type: EntityType;
  local_transform: CryoTransform;
  world_transform?: CryoTransform;
  parent_id: string;
  child_ids: string[];
  components: EntityComponentProto[];
  enabled: boolean;
  visible: boolean;
  tags: string[];
}

export interface EntityComponentProto {
  component_id: string;
  type: ComponentType;
  enabled: boolean;
  mesh?: MeshComponentProto;
  light?: LightComponentProto;
  camera?: CameraComponentProto;
  audio?: AudioComponentProto;
  collider?: ColliderComponentProto;
  rigidbody?: RigidbodyComponentProto;
  script?: ScriptComponentProto;
  properties: Record<string, string>;
}

export interface MeshComponentProto {
  mesh_asset_uri: string;
  material_asset_uris: string[];
  cast_shadows: boolean;
  receive_shadows: boolean;
}

export interface LightComponentProto {
  type: 'DIRECTIONAL' | 'POINT' | 'SPOT' | 'AREA';
  position: CryoVec3;
  direction: CryoVec3;
  color: CryoColor;
  intensity: number;
  range: number;
  cast_shadows: boolean;
}

export interface CameraComponentProto {
  position: CryoVec3;
  rotation: CryoVec3;
  fov: number;
  near_plane: number;
  far_plane: number;
  projection: 'PERSPECTIVE' | 'ORTHOGRAPHIC';
}

export interface AudioComponentProto {
  audio_clip_uri: string;
  loop: boolean;
  volume: number;
  spatial_blend: number;
  play_on_start: boolean;
}

export interface ColliderComponentProto {
  type: 'BOX' | 'SPHERE' | 'CAPSULE' | 'MESH';
  is_trigger: boolean;
  center: CryoVec3;
  size?: CryoVec3;
  radius?: number;
  height?: number;
  mesh_uri?: string;
}

export interface RigidbodyComponentProto {
  mass: number;
  drag: number;
  angular_drag: number;
  use_gravity: boolean;
  is_kinematic: boolean;
}

export interface ScriptComponentProto {
  script_name: string;
  script_uri: string;
  parameters: Record<string, string>;
}

export interface SceneProto {
  scene_id: string;
  name: string;
  entities: EntityProto[];
}

// ============================================================================
// Compiler
// ============================================================================

export interface CompileResult {
  scene?: SceneProto;
  entities: EntityProto[];
  errors: CompileError[];
}

export interface CompileError {
  message: string;
  entityId?: string;
}

/**
 * Compile a CryoDocument to protocol buffer format
 */
export function compile(document: CryoDocument, assetResolver?: AssetResolver): CompileResult {
  const errors: CompileError[] = [];
  const entities: EntityProto[] = [];

  const resolver = assetResolver || createDefaultResolver(document);

  if (document.scene) {
    for (const entity of document.scene.entities) {
      const compiled = compileEntity(entity, '', resolver, errors);
      entities.push(compiled);
      entities.push(...flattenChildren(entity, compiled.entity_id, resolver, errors));
    }

    return {
      scene: {
        scene_id: document.scene.id,
        name: document.scene.name || document.scene.id,
        entities,
      },
      entities,
      errors,
    };
  }

  return { entities, errors };
}

function flattenChildren(
  entity: Entity,
  parentId: string,
  resolver: AssetResolver,
  errors: CompileError[]
): EntityProto[] {
  const result: EntityProto[] = [];

  for (const child of entity.children) {
    const compiled = compileEntity(child, parentId, resolver, errors);
    result.push(compiled);
    result.push(...flattenChildren(child, compiled.entity_id, resolver, errors));
  }

  return result;
}

function compileEntity(
  entity: Entity,
  parentId: string,
  resolver: AssetResolver,
  errors: CompileError[]
): EntityProto {
  const components: EntityComponentProto[] = [];

  for (const component of entity.components) {
    const compiled = compileComponent(component, entity.id, resolver, errors);
    if (compiled) {
      components.push(compiled);
    }
  }

  // Add script component if entity has inline script
  if (entity.script) {
    components.push({
      component_id: `${entity.id}_script`,
      type: ComponentType.SCRIPT,
      enabled: true,
      script: {
        script_name: `${entity.id}_script`,
        script_uri: entity.script.src || `inline://${entity.id}_script.lua`,
        parameters: entity.script.inline ? { source: entity.script.inline } : {},
      },
      properties: {},
    });
  }

  return {
    entity_id: entity.id,
    name: entity.name || entity.id,
    type: inferEntityType(entity),
    local_transform: compileTransform(entity.transform),
    parent_id: parentId,
    child_ids: entity.children.map((c) => c.id),
    components,
    enabled: entity.enabled,
    visible: true,
    tags: entity.tags || [],
  };
}

function compileTransform(transform: Transform): CryoTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale },
  };
}

function compileComponent(
  component: Component,
  entityId: string,
  resolver: AssetResolver,
  _errors: CompileError[]
): EntityComponentProto | null {
  switch (component.type) {
    case 'mesh':
      return compileMeshComponent(component, entityId, resolver);
    case 'light':
      return compileLightComponent(component, entityId);
    case 'camera':
      return compileCameraComponent(component, entityId);
    case 'collider':
      return compileColliderComponent(component, entityId);
    case 'rigidbody':
      return compileRigidbodyComponent(component, entityId);
    case 'audio-source':
      return compileAudioComponent(component, entityId, resolver);
    case 'custom':
      return compileCustomComponent(component, entityId);
    default:
      return null;
  }
}

function compileMeshComponent(
  component: MeshComponent,
  entityId: string,
  resolver: AssetResolver
): EntityComponentProto {
  return {
    component_id: `${entityId}_mesh`,
    type: ComponentType.MESH,
    enabled: true,
    mesh: {
      mesh_asset_uri: resolver.resolveAsset(component.asset),
      material_asset_uris: [],
      cast_shadows: component.castShadows,
      receive_shadows: component.receiveShadows,
    },
    properties: {},
  };
}

function compileLightComponent(component: LightComponent, entityId: string): EntityComponentProto {
  const lightTypeMap: Record<string, 'DIRECTIONAL' | 'POINT' | 'SPOT' | 'AREA'> = {
    directional: 'DIRECTIONAL',
    point: 'POINT',
    spot: 'SPOT',
    area: 'AREA',
  };

  return {
    component_id: `${entityId}_light`,
    type: ComponentType.LIGHT,
    enabled: true,
    light: {
      type: lightTypeMap[component.lightType] || 'POINT',
      position: { x: 0, y: 0, z: 0 },
      direction: { x: 0, y: -1, z: 0 },
      color: { ...component.color },
      intensity: component.intensity,
      range: component.range || 10,
      cast_shadows: component.castShadows,
    },
    properties: {},
  };
}

function compileCameraComponent(component: CameraComponent, entityId: string): EntityComponentProto {
  return {
    component_id: `${entityId}_camera`,
    type: ComponentType.CAMERA,
    enabled: true,
    camera: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      fov: component.fov,
      near_plane: component.near,
      far_plane: component.far,
      projection: component.projection === 'orthographic' ? 'ORTHOGRAPHIC' : 'PERSPECTIVE',
    },
    properties: {},
  };
}

function compileColliderComponent(component: ColliderComponent, entityId: string): EntityComponentProto {
  const colliderTypeMap: Record<string, 'BOX' | 'SPHERE' | 'CAPSULE' | 'MESH'> = {
    box: 'BOX',
    sphere: 'SPHERE',
    capsule: 'CAPSULE',
    mesh: 'MESH',
  };

  return {
    component_id: `${entityId}_collider`,
    type: ComponentType.COLLIDER,
    enabled: true,
    collider: {
      type: colliderTypeMap[component.colliderType] || 'BOX',
      is_trigger: component.trigger,
      center: { x: 0, y: 0, z: 0 },
      size: component.size,
      radius: component.radius,
      height: component.height,
      mesh_uri: component.asset,
    },
    properties: {},
  };
}

function compileRigidbodyComponent(component: RigidbodyComponent, entityId: string): EntityComponentProto {
  return {
    component_id: `${entityId}_rigidbody`,
    type: ComponentType.RIGIDBODY,
    enabled: true,
    rigidbody: {
      mass: component.mass,
      drag: component.drag,
      angular_drag: component.angularDrag,
      use_gravity: component.useGravity,
      is_kinematic: component.kinematic,
    },
    properties: {},
  };
}

function compileAudioComponent(
  component: AudioSourceComponent,
  entityId: string,
  resolver: AssetResolver
): EntityComponentProto {
  return {
    component_id: `${entityId}_audio`,
    type: ComponentType.AUDIO,
    enabled: true,
    audio: {
      audio_clip_uri: resolver.resolveAsset(component.asset),
      loop: component.loop,
      volume: component.volume,
      spatial_blend: component.spatial ? 1.0 : 0.0,
      play_on_start: component.playOnStart,
    },
    properties: {},
  };
}

function compileCustomComponent(component: CustomComponent, entityId: string): EntityComponentProto {
  return {
    component_id: `${entityId}_${component.componentType}`,
    type: ComponentType.UNKNOWN,
    enabled: true,
    properties: {
      type: component.componentType,
      ...component.properties,
    },
  };
}

function inferEntityType(entity: Entity): EntityType {
  if (entity.prefab) return EntityType.PREFAB_INSTANCE;

  for (const component of entity.components) {
    switch (component.type) {
      case 'mesh':
        return EntityType.MESH;
      case 'light':
        return EntityType.LIGHT;
      case 'camera':
        return EntityType.CAMERA;
      case 'audio-source':
        return EntityType.AUDIO_SOURCE;
    }
  }

  if (entity.children.length > 0) return EntityType.EMPTY;

  return EntityType.UNKNOWN;
}

// ============================================================================
// Asset Resolver
// ============================================================================

export interface AssetResolver {
  resolveAsset(assetId: string): string;
}

function createDefaultResolver(document: CryoDocument): AssetResolver {
  const assetMap = new Map<string, string>();

  if (document.imports?.assets) {
    for (const asset of document.imports.assets) {
      assetMap.set(asset.id, asset.src);
    }
  }

  return {
    resolveAsset(assetId: string): string {
      return assetMap.get(assetId) || assetId;
    },
  };
}

// ============================================================================
// Serialization
// ============================================================================

export type OutputFormat = 'json' | 'pbtxt';

/**
 * Serialize compiled scene to string
 */
export function serialize(result: CompileResult, format: OutputFormat = 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result.scene || { entities: result.entities }, null, 2);
  }

  // Protocol Buffer Text Format
  return serializeToPbtxt(result);
}

function serializeToPbtxt(result: CompileResult): string {
  const lines: string[] = [];

  if (result.scene) {
    lines.push(`scene_id: "${result.scene.scene_id}"`);
    lines.push(`name: "${result.scene.name}"`);
    lines.push('');
  }

  for (const entity of result.entities) {
    lines.push('entities {');
    lines.push(`  entity_id: "${entity.entity_id}"`);
    lines.push(`  name: "${entity.name}"`);
    lines.push(`  type: ${EntityType[entity.type]}`);
    lines.push('');
    lines.push('  local_transform {');
    lines.push(`    position { x: ${entity.local_transform.position.x} y: ${entity.local_transform.position.y} z: ${entity.local_transform.position.z} }`);
    lines.push(`    rotation { x: ${entity.local_transform.rotation.x} y: ${entity.local_transform.rotation.y} z: ${entity.local_transform.rotation.z} w: ${entity.local_transform.rotation.w} }`);
    lines.push(`    scale { x: ${entity.local_transform.scale.x} y: ${entity.local_transform.scale.y} z: ${entity.local_transform.scale.z} }`);
    lines.push('  }');

    if (entity.parent_id) {
      lines.push(`  parent_id: "${entity.parent_id}"`);
    }

    for (const childId of entity.child_ids) {
      lines.push(`  child_ids: "${childId}"`);
    }

    for (const component of entity.components) {
      lines.push('');
      lines.push('  components {');
      lines.push(`    component_id: "${component.component_id}"`);
      lines.push(`    type: ${ComponentType[component.type]}`);
      lines.push(`    enabled: ${component.enabled}`);

      if (component.mesh) {
        lines.push('    mesh {');
        lines.push(`      mesh_asset_uri: "${component.mesh.mesh_asset_uri}"`);
        lines.push(`      cast_shadows: ${component.mesh.cast_shadows}`);
        lines.push(`      receive_shadows: ${component.mesh.receive_shadows}`);
        lines.push('    }');
      }

      if (component.script) {
        lines.push('    script {');
        lines.push(`      script_name: "${component.script.script_name}"`);
        lines.push(`      script_uri: "${component.script.script_uri}"`);
        lines.push('    }');
      }

      lines.push('  }');
    }

    lines.push(`  enabled: ${entity.enabled}`);
    lines.push(`  visible: ${entity.visible}`);

    for (const tag of entity.tags) {
      lines.push(`  tags: "${tag}"`);
    }

    lines.push('}');
    lines.push('');
  }

  return lines.join('\n');
}
