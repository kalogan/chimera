import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Aspect-aware FOV. The fixed-camera stages were framed for a WIDE desktop aspect;
 * on a narrow phone (portrait) the horizontal field of view collapses, so the
 * goobers balloon and overlap (they filled the whole screen on mobile). This
 * widens the vertical FOV on narrow viewports to keep the HORIZONTAL framing
 * roughly constant — a no-op on wide screens (aspect >= designAspect), a zoom-out
 * on portrait, capped so it never fisheyes. Touches only `fov` (never position or
 * lookAt), so every stage's desktop framing is preserved exactly.
 */
export function ResponsiveFov({
  baseFov,
  designAspect = 1.4,
  maxFov = 58,
}: {
  baseFov: number;
  designAspect?: number;
  maxFov?: number;
}) {
  const cam = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  useEffect(() => {
    if (!(cam instanceof THREE.PerspectiveCamera)) return;
    const aspect = width / Math.max(1, height);
    const factor = Math.max(1, designAspect / aspect);
    cam.fov = Math.min(maxFov, baseFov * factor);
    cam.updateProjectionMatrix();
  }, [cam, width, height, baseFov, designAspect, maxFov]);
  return null;
}
