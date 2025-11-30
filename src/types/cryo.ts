/**
 * .cryo File Format Type Definitions
 * Maps to cryo-protocol messages
 */

// ============================================================================
// Primitive Types
// ============================================================================

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec4; // quaternion
  scale: Vec3;
}

// ============================================================================
// Document Structure
// ============================================================================

export interface CryoDocument {
  version: string;
  meta?: Meta;
  imports?: Imports;
  scene?: Scene;
  prefab?: Prefab;
}

export interface Meta {
  name?: string;
  description?: string;
  author?: string;
  created?: string;
  tags?: string[];
}

export interface Imports {
  imports: Import[];
  assets: Asset[];
  luaModules: LuaModule[];
}

export interface Import {
  src: string;
  as?: string;
}

export interface Asset {
  id: string;
  type: AssetType;
  src: string;
}

export type AssetType = 'gltf' | 'glb' | 'texture' | 'audio' | 'material' | 'shader' | 'prefab';

export interface LuaModule {
  id: string;
  src: string;
}

// ============================================================================
// Scene
// ============================================================================

export interface Scene {
  id: string;
  name?: string;
  environment?: Environment;
  entities: Entity[];
  systems?: System[];
}

export interface Environment {
  skybox?: Skybox;
  lighting?: Lighting;
  fog?: Fog;
  physics?: Physics;
}

export interface Skybox {
  type: 'hdri' | 'cubemap' | 'procedural' | 'solid';
  src?: string;
  timeOfDay?: string;
  color?: Color;
}

export interface Lighting {
  ambient?: AmbientLight;
  directional: DirectionalLight[];
}

export interface AmbientLight {
  color: Color;
  intensity: number;
}

export interface DirectionalLight {
  id?: string;
  color: Color;
  intensity: number;
  direction: Vec3;
  castShadows: boolean;
}

export interface Fog {
  enabled: boolean;
  color: Color;
  density: number;
}

export interface Physics {
  gravity: Vec3;
}

// ============================================================================
// Entity
// ============================================================================

export interface Entity {
  id: string;
  name?: string;
  prefab?: string;
  enabled: boolean;
  transform: Transform;
  components: Component[];
  children: Entity[];
  script?: Script;
  tags?: string[];
}

// ============================================================================
// Components
// ============================================================================

export type Component =
  | MeshComponent
  | MaterialComponent
  | LightComponent
  | CameraComponent
  | ColliderComponent
  | RigidbodyComponent
  | AudioSourceComponent
  | CustomComponent;

export interface BaseComponent {
  type: string;
  enabled?: boolean;
}

export interface MeshComponent extends BaseComponent {
  type: 'mesh';
  asset: string;
  castShadows: boolean;
  receiveShadows: boolean;
}

export interface MaterialComponent extends BaseComponent {
  type: 'material';
  shader: string;
  asset?: string;
  properties: Record<string, string | number | Color>;
}

export interface LightComponent extends BaseComponent {
  type: 'light';
  lightType: 'point' | 'spot' | 'directional' | 'area';
  color: Color;
  intensity: number;
  range?: number;
  castShadows: boolean;
}

export interface CameraComponent extends BaseComponent {
  type: 'camera';
  fov: number;
  near: number;
  far: number;
  projection: 'perspective' | 'orthographic';
}

export interface ColliderComponent extends BaseComponent {
  type: 'collider';
  colliderType: 'box' | 'sphere' | 'capsule' | 'mesh';
  size?: Vec3;
  radius?: number;
  height?: number;
  trigger: boolean;
  asset?: string;
}

export interface RigidbodyComponent extends BaseComponent {
  type: 'rigidbody';
  mass: number;
  drag: number;
  angularDrag: number;
  useGravity: boolean;
  kinematic: boolean;
}

export interface AudioSourceComponent extends BaseComponent {
  type: 'audio-source';
  asset: string;
  volume: number;
  loop: boolean;
  spatial: boolean;
  playOnStart: boolean;
}

export interface CustomComponent extends BaseComponent {
  type: 'custom';
  componentType: string;
  properties: Record<string, string>;
}

// ============================================================================
// Script
// ============================================================================

export interface Script {
  src?: string;
  inline?: string;
}

// ============================================================================
// Prefab
// ============================================================================

export interface Prefab {
  id: string;
  name?: string;
  transform: Transform;
  components: Component[];
  children: Entity[];
  script?: Script;
}

// ============================================================================
// System
// ============================================================================

export interface System {
  type: string;
  enabled: boolean;
  properties: Record<string, string>;
}

// ============================================================================
// Entity Type Enumeration (matches cryo_entity.proto)
// ============================================================================

export enum EntityType {
  UNKNOWN = 0,
  EMPTY = 1,
  MESH = 2,
  LIGHT = 3,
  CAMERA = 4,
  PARTICLE_SYSTEM = 5,
  AUDIO_SOURCE = 6,
  PHYSICS_BODY = 7,
  TRIGGER = 8,
  TERRAIN = 9,
  WATER = 10,
  DECAL = 11,
  LOD_GROUP = 12,
  PREFAB_INSTANCE = 13,
  CHARACTER = 14,
  VEHICLE = 15,
  BUILDING = 16,
  PROP = 17,
  UI_ELEMENT = 18,
}

// ============================================================================
// Component Type Enumeration (matches cryo_entity.proto)
// ============================================================================

export enum ComponentType {
  UNKNOWN = 0,
  MESH = 1,
  LIGHT = 2,
  CAMERA = 3,
  AUDIO = 4,
  PHYSICS = 5,
  SCRIPT = 6,
  ANIMATION = 7,
  PARTICLE_SYSTEM = 8,
  COLLIDER = 9,
  RIGIDBODY = 10,
  CHARACTER_CONTROLLER = 11,
  NAVMESH_AGENT = 12,
  TERRAIN = 13,
  DECAL = 14,
}
