import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";
import type { GooberSpec } from "game-kit/creature";
import { getQuality, getReducedMotion } from "./quality.js";

// Field → world mapping. Metaballs live in the MarchingCubes [0,1] field; its mesh
// spans geometry [-1,1]; a parent group scales that to WORLD. K scales creature-local
// units into the field; YOFF lifts the creature so its feet sit near the field floor.
const ISO = 80;
const SUB = 12;
const K = 0.26;
const YOFF = 0.14;
const WORLD = 4;

const toGeom = (x: number, y: number, z: number): [number, number, number] => [
  2 * K * x,
  2 * YOFF - 1 + 2 * K * y,
  2 * K * z,
];

// ── shading knobs (taste-tunable, single numbers) ──
// Cel-shading band count for the toon gradient map: fewer bands = chunkier,
// more painterly cartoon look; more bands = smoother falloff.
const TOON_BANDS = 4;
// Rim-light strength: how bright the fresnel edge glow gets at grazing angles.
const RIM_STRENGTH = 0.55;
// Rim tint — a soft warm-white edge glow (kept subtle, not neon).
const RIM_COLOR = new THREE.Color("#fff6e0");
// Eye specular highlight: size (relative to eye radius) and brightness.
const EYE_HILITE_SCALE = 0.28;
const EYE_HILITE_OPACITY = 0.9;

/** A small banded gradient texture for MeshToonMaterial's `gradientMap` — gives
 * softer, chunkier cel-shading bands than the default 3-tone toon ramp. Built
 * once in-code (no asset file) and shared across all goobers. */
let _gradientMapCache: THREE.Texture | null = null;
function getToonGradientMap(): THREE.Texture {
  if (_gradientMapCache) return _gradientMapCache;
  const canvas = document.createElement("canvas");
  canvas.width = TOON_BANDS;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(TOON_BANDS, 1);
  for (let i = 0; i < TOON_BANDS; i++) {
    // Ease the bands so shadow side stays moody but midtones stay soft/bright —
    // charming rather than harsh comic-book contrast.
    const t = i / (TOON_BANDS - 1);
    const v = Math.round(255 * (0.35 + 0.65 * t));
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.Texture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  _gradientMapCache = tex;
  return tex;
}

/** Cheap fresnel rim-light shader: brightens fragments near the silhouette
 * (where the view direction grazes the surface normal), additive-blended so it
 * only ever adds a soft edge glow — never darkens the toon body underneath. */
const RIM_VERTEX = `
varying vec3 vRimNormal;
varying vec3 vRimView;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vRimNormal = normalize(normalMatrix * normal);
  vRimView = normalize(cameraPosition - worldPos.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;
const RIM_FRAGMENT = `
uniform vec3 rimColor;
uniform float rimStrength;
varying vec3 vRimNormal;
varying vec3 vRimView;
void main() {
  float fresnel = 1.0 - max(dot(normalize(vRimNormal), normalize(vRimView)), 0.0);
  float rim = pow(fresnel, 2.5) * rimStrength;
  gl_FragColor = vec4(rimColor, rim);
}
`;

/**
 * Render a goober from its `creature.gooberSpec` (the token→body data). The body is
 * a MarchingCubes metaball field; the eyes are little spheres. PROCEDURAL IDLE
 * ANIMATION — a gentle breathe/bob (scale + vertical) plus an occasional blink —
 * makes each critter feel alive without any rig. `seed` de-syncs the phases so a
 * row of creatures doesn't bob in lockstep. `blink` collapses the eye whites in Y.
 */
export function Goober({
  spec,
  position,
  seed = 0,
  facing = 0,
  fainted = false,
  sizeScale = 1,
}: {
  spec: GooberSpec;
  position: [number, number, number];
  seed?: number;
  facing?: number;
  fainted?: boolean;
  /** World-size multiplier — overworld goobers are smaller than battle-stage ones. */
  sizeScale?: number;
}) {
  const base = spec.scale * WORLD * sizeScale;
  const group = useRef<THREE.Group>(null);
  const eyeGroup = useRef<THREE.Group>(null);
  // Device-adaptive (read once per mount; a Settings change re-mounts scenes).
  const RES = getQuality().gooberRes;
  const rim = getQuality().rim;
  const reducedMotion = getReducedMotion();

  const mc = useMemo(() => {
    const mat = new THREE.MeshToonMaterial({
      vertexColors: true,
      gradientMap: getToonGradientMap(),
    });
    const m = new MarchingCubes(RES, mat, false, true, 400000);
    m.isolation = ISO;
    m.reset();
    for (const b of spec.balls) {
      const strength = b.s * K * (b.s * K) * (ISO + SUB);
      m.addBall(
        0.5 + b.x * K,
        YOFF + b.y * K,
        0.5 + b.z * K,
        strength,
        SUB,
        new THREE.Color(b.color[0], b.color[1], b.color[2]),
      );
    }
    m.update();
    return m;
  }, [spec, RES]);

  // Fresnel rim-light shell: reuses the MC-generated geometry (no extra field
  // solve), additive-blended so it only ever brightens the silhouette edge.
  const rimMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          rimColor: { value: RIM_COLOR },
          rimStrength: { value: RIM_STRENGTH },
        },
        vertexShader: RIM_VERTEX,
        fragmentShader: RIM_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  // Gentle breathe/bob + occasional blink. Deterministic per-creature phase offset.
  // Fainted: tip over, sink, and hold still (creatures faint — never die — so keep
  // it tender, a gentle slump rather than a violent fall).
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const ph = (seed % 100) * 0.618;
    if (group.current) {
      if (fainted) {
        group.current.scale.setScalar(base * 0.9);
        group.current.position.y = position[1] - 0.5;
        group.current.rotation.set(0, facing, 1.15);
      } else if (reducedMotion) {
        // Accessibility: hold a still, upright pose — no breathe/bob/wobble.
        group.current.scale.setScalar(base);
        group.current.position.y = position[1];
        group.current.rotation.set(0, facing, 0);
      } else {
        const breathe = 1 + Math.sin(t * 1.6 + ph) * 0.035;
        group.current.scale.setScalar(base * breathe);
        group.current.position.y = position[1] + Math.sin(t * 1.1 + ph) * 0.08;
        group.current.rotation.set(0, facing + Math.sin(t * 0.5 + ph) * 0.06, 0);
      }
    }
    if (eyeGroup.current) {
      if (fainted) {
        eyeGroup.current.scale.y = 0.12; // eyes closed
      } else if (reducedMotion) {
        eyeGroup.current.scale.y = 1; // no blink
      } else {
        // Blink: a brief eye-white squash on a slow, offset cycle.
        const cycle = (t * 0.9 + ph) % 4;
        const blink = cycle > 3.85 ? Math.max(0.08, 1 - (cycle - 3.85) * 13) : 1;
        eyeGroup.current.scale.y = blink;
      }
    }
  });

  return (
    <group
      ref={group}
      position={position}
      scale={base}
      rotation={[0, facing, 0]}
    >
      <primitive object={mc} />
      {rim && <mesh geometry={mc.geometry} material={rimMat} />}
      <group ref={eyeGroup}>
        {spec.eyes.map((e, i) => {
          const g = toGeom(e.x, e.y, e.z);
          const r = e.r * 2 * K;
          return (
            <group key={i} position={g}>
              <mesh>
                <sphereGeometry args={[r, 16, 16]} />
                <meshToonMaterial color="#ffffff" />
              </mesh>
              <mesh position={[0, 0, r * 0.65]}>
                <sphereGeometry args={[r * 0.55, 12, 12]} />
                <meshBasicMaterial color="#1a1420" />
              </mesh>
              {/* Tiny specular catch-light — offset up/side of the pupil so the
                  eye reads as wet + alive rather than a flat dot. */}
              <mesh position={[r * 0.28, r * 0.32, r * 0.95]}>
                <sphereGeometry args={[r * EYE_HILITE_SCALE, 8, 8]} />
                <meshBasicMaterial
                  color="#ffffff"
                  transparent
                  opacity={EYE_HILITE_OPACITY}
                />
              </mesh>
            </group>
          );
        })}
      </group>
    </group>
  );
}
