import { Canvas, Circle, Fill, RadialGradient, Shader, Skia, vec } from '@shopify/react-native-skia';
import { StyleSheet, View } from 'react-native';

const STOPS = 16;

/** Az ffmpeg `vignette` sötétítése a középponttól mért arány szerint: cos⁴. */
export function vignetteFactor(angle: number, r: number): number {
  const c = Math.cos(angle * Math.min(1, r));
  return c * c * c * c;
}

/** 🔦 A dokumentum-szintű vignetták a vásznon: ugyanaz a görbe, mint a renderben, egymásra szorozva. */
export function DocVignette({ angles, box }: { angles: number[]; box: { w: number; h: number } }) {
  if (angles.length === 0) {
    return null;
  }
  const radius = Math.hypot(box.w, box.h) / 2;
  const positions = Array.from({ length: STOPS + 1 }, (_, i) => i / STOPS);
  const colors = positions.map((r) => `rgba(0,0,0,${(1 - angles.reduce((f, a) => f * vignetteFactor(a, r), 1)).toFixed(4)})`);
  const center = vec(box.w / 2, box.h / 2);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Circle cx={center.x} cy={center.y} r={radius}>
          <RadialGradient c={center} r={radius} colors={colors} positions={positions} />
        </Circle>
      </Canvas>
    </View>
  );
}

const GRAIN_SHADER = `
uniform float amp;
uniform float cell;
float rnd(float2 p) { return fract(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }
half4 main(float2 xy) {
  float n = rnd(floor(xy / cell)) - 0.5;
  float a = abs(n) * amp;
  return n > 0.0 ? half4(a, a, a, a) : half4(0.0, 0.0, 0.0, a);
}`;

let grainEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;

/** 🌾 Filmszemcse a vásznon: az export zajával azonos szórás, világos/sötét pettyekből (keverési mód nélkül). */
export function DocGrain({ grain, cell }: { grain: number; cell: number }) {
  grainEffect ??= Skia.RuntimeEffect.Make(GRAIN_SHADER);
  if (!(grain > 0) || !grainEffect) {
    return null;
  }
  // az ffmpeg zaja ±s/2 a 255-ös skálán; a pettyek középszürkén a felét mozdítják, ezért a kétszerese
  const amp = (Math.round(grain * 30) / 255) * 2;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.clip]}>
      <Canvas colorSpace="srgb" style={StyleSheet.absoluteFill}>
        <Fill>
          <Shader source={grainEffect} uniforms={{ amp, cell }} />
        </Fill>
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({ clip: { overflow: 'hidden' } });
