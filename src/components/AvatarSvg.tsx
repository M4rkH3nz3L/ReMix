import Svg, { Circle, Ellipse, G, Line, Path, Polygon, Rect } from 'react-native-svg';

import {
  BG_COLORS,
  HAIR_COLORS,
  SKIN_TONES,
  normalizeAvatar,
  type AvatarConfig,
} from '@/lib/avatar';

/**
 * 🧑‍🎨 SVG-avatar — a felhasználó által összerakott karaktert rajzolja ki a
 * config-vonásokból (bőrszín, haj, arc, kiegészítő, háttér). Geometriai
 * primitívekből (kör/ellipszis/path), így skálázható és tömör.
 */
export function AvatarSvg({
  config,
  size = 48,
}: {
  config: AvatarConfig | null | undefined;
  size?: number;
}) {
  const c = normalizeAvatar(config);
  const skin = SKIN_TONES[c.skin];
  const hair = HAIR_COLORS[c.hairColor];
  const bg = BG_COLORS[c.bg];
  const ink = '#20242c';

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* háttér */}
      <Circle cx={50} cy={50} r={50} fill={bg} />

      {/* hosszú haj hátul (2) */}
      {c.hair === 2 ? (
        <G>
          <Rect x={18} y={34} width={13} height={46} rx={6} fill={hair} />
          <Rect x={69} y={34} width={13} height={46} rx={6} fill={hair} />
        </G>
      ) : null}

      {/* fej + fül */}
      <Circle cx={31} cy={56} r={6} fill={skin} />
      <Circle cx={69} cy={56} r={6} fill={skin} />
      <Circle cx={50} cy={54} r={30} fill={skin} />

      {/* haj felül */}
      {c.hair !== 0 ? <Ellipse cx={50} cy={31} rx={31} ry={19} fill={hair} /> : null}
      {c.hair === 3 ? (
        <G>
          <Circle cx={26} cy={22} r={9} fill={hair} />
          <Circle cx={74} cy={22} r={9} fill={hair} />
        </G>
      ) : null}
      {c.hair === 4 ? (
        <G>
          <Polygon points="30,26 38,6 46,26" fill={hair} />
          <Polygon points="44,26 52,4 60,26" fill={hair} />
          <Polygon points="58,26 66,8 72,26" fill={hair} />
        </G>
      ) : null}
      {c.hair === 5 ? <Ellipse cx={50} cy={24} rx={14} ry={9} fill={hair} /> : null}

      {/* arc — szemek + száj kifejezés szerint */}
      <Face face={c.face} ink={ink} />

      {/* kiegészítő */}
      <Accessory accessory={c.accessory} ink={ink} />
    </Svg>
  );
}

function Face({ face, ink }: { face: number; ink: string }) {
  const smile =
    face === 1
      ? 'M37,60 Q50,74 63,60'
      : face === 4
        ? ''
        : 'M40,62 Q50,70 60,62';
  return (
    <G>
      {/* szemek */}
      {face === 3 ? (
        <G>
          <Line x1={34} y1={52} x2={43} y2={52} stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
          <Line x1={57} y1={52} x2={66} y2={52} stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      ) : face === 2 ? (
        <G>
          <Circle cx={39} cy={52} r={3.5} fill={ink} />
          <Line x1={57} y1={52} x2={66} y2={52} stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      ) : (
        <G>
          <Circle cx={39} cy={52} r={face === 4 ? 4.2 : 3.5} fill={ink} />
          <Circle cx={61} cy={52} r={face === 4 ? 4.2 : 3.5} fill={ink} />
        </G>
      )}
      {/* száj */}
      {face === 4 ? (
        <Circle cx={50} cy={65} r={4} fill="none" stroke={ink} strokeWidth={2.5} />
      ) : (
        <Path d={smile} fill="none" stroke={ink} strokeWidth={2.5} strokeLinecap="round" />
      )}
    </G>
  );
}

function Accessory({ accessory, ink }: { accessory: number; ink: string }) {
  switch (accessory) {
    case 1: // szemüveg
      return (
        <G>
          <Circle cx={39} cy={52} r={8} fill="none" stroke={ink} strokeWidth={2} />
          <Circle cx={61} cy={52} r={8} fill="none" stroke={ink} strokeWidth={2} />
          <Line x1={47} y1={52} x2={53} y2={52} stroke={ink} strokeWidth={2} />
        </G>
      );
    case 2: // napszemüveg
      return (
        <G>
          <Rect x={30} y={46} width={16} height={11} rx={3} fill={ink} />
          <Rect x={54} y={46} width={16} height={11} rx={3} fill={ink} />
          <Line x1={46} y1={50} x2={54} y2={50} stroke={ink} strokeWidth={2} />
        </G>
      );
    case 3: // kalap
      return (
        <G>
          <Rect x={20} y={22} width={60} height={6} rx={3} fill={ink} />
          <Rect x={32} y={6} width={36} height={18} rx={4} fill={ink} />
        </G>
      );
    case 4: // fejhallgató
      return (
        <G>
          <Path d="M20,48 A30,30 0 0 1 80,48" fill="none" stroke={ink} strokeWidth={4} />
          <Rect x={15} y={46} width={9} height={16} rx={4} fill={ink} />
          <Rect x={76} y={46} width={9} height={16} rx={4} fill={ink} />
        </G>
      );
    case 5: // fülbevaló
      return (
        <G>
          <Circle cx={24} cy={64} r={3} fill="#ffd35c" />
          <Circle cx={76} cy={64} r={3} fill="#ffd35c" />
        </G>
      );
    default:
      return null;
  }
}
