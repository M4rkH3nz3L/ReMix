import { Text } from 'react-native';

import { palette } from '@/constants/editor';
import { renderFontFamily } from '@/constants/fonts';
import {
  STROKE_DIRS,
  text3dFaceColor,
  type glowCopyOf,
  type KaraokeWord,
  type presetStyles,
  type textTypography,
} from '@/lib/textOverlayStyle';
import type { TextClip } from '@/types/project';

export interface TextOverlayGlyphsProps {
  clip: TextClip;
  fontSize: number;
  preset: ReturnType<typeof presetStyles>;
  typo: ReturnType<typeof textTypography>;
  glowCopy: ReturnType<typeof glowCopyOf>;
  tightShift: number;
  shown: string;
  karaokeWords: KaraokeWord[] | null;
}

/**
 * A szöveg-réteg betű-rétegei a doboz belsejében (REFACTOR: a TextOverlay.tsx-ből), a
 * rajzolási sorrend változatlan: ragyogás-másolat, körvonal-másolatok, 3D mélység-másolat,
 * majd a fő szöveg (karaoke-szavakkal).
 */
export function TextOverlayGlyphs({
  clip,
  fontSize,
  preset,
  typo,
  glowCopy,
  tightShift,
  shown,
  karaokeWords,
}: TextOverlayGlyphsProps) {
  return (
    <>
      {glowCopy ? (
        // ragyogás / neon: a render két árnyékot rétegez, az RN-szövegnek egy árnyéka van → a második
        // réteg egy betű mögötti, ragyogás-színű másolat árnyéka (iPaden mérve: egy árnyékkal az
        // energia 0,59–0,71×)
        <Text
          allowFontScaling={false}
          style={{
            position: 'absolute',
            // a nagy sugarú árnyékot a szöveg kerete levágná: a másolat kerete függőlegesen a sugárral nagyobb
            left: 0,
            top: -glowCopy.radius,
            right: 0,
            paddingBottom: glowCopy.radius,
            color: glowCopy.color,
            fontSize,
            fontWeight: clip.fontWeight,
            fontFamily: renderFontFamily(clip.fontFamily, clip.fontWeight),
            textAlign: clip.textAlign ?? 'center',
            ...typo,
            paddingTop: tightShift + glowCopy.radius,
            textShadowColor: glowCopy.color,
            textShadowRadius: glowCopy.radius,
            textShadowOffset: { width: 0, height: 0 },
            ...(clip.fontStyle === 'italic' ? { transform: [{ skewX: '-12deg' }] } : null),
          }}
        >
          {shown}
        </Text>
      ) : null}
      {!clip.text3d && clip.textStyle?.stroke
        ? // körvonal: az RN-szövegnek nincs kontúrja, ezért eltolt másolatok a betűk mögött (a CSS-stroke fele kifelé esik)
          STROKE_DIRS.map(([dx, dy]) => (
            <Text
              allowFontScaling={false}
              key={`${dx}${dy}`}
              style={{
                position: 'absolute',
                left: dx * (clip.textStyle!.stroke!.width * fontSize) / 2,
                right: -dx * (clip.textStyle!.stroke!.width * fontSize) / 2,
                color: clip.textStyle!.stroke!.color,
                fontSize,
                fontWeight: clip.fontWeight,
                fontFamily: renderFontFamily(clip.fontFamily, clip.fontWeight),
                textAlign: clip.textAlign ?? 'center',
                ...typo,
                top: dy * (clip.textStyle!.stroke!.width * fontSize) / 2,
                paddingTop: tightShift,
              }}
            >
              {shown}
            </Text>
          ))
        : null}
      {clip.text3d ? (
        // extrúzió-közelítés: sötét mélység-másolat a szöveg mögött
        <Text
          allowFontScaling={false}
          style={{
            position: 'absolute',
            left: fontSize * clip.text3d.depth * 0.12,
            top: fontSize * clip.text3d.depth * 0.12,
            color: '#1c1c24',
            fontSize,
            fontWeight: '800',
            fontFamily: renderFontFamily(clip.fontFamily, '800'),
            textAlign: 'center',
          }}
        >
          {shown}
        </Text>
      ) : null}
      <Text
        allowFontScaling={false}
        style={[
          {
            color: clip.text3d ? text3dFaceColor(clip.text3d, clip.color) : clip.color,
            fontSize,
            fontWeight: clip.text3d ? '800' : clip.fontWeight,
            // a stílus-preset (pl. körvonal: 900) a vastagságot felülírja → a fájlt is az választja
            fontFamily: renderFontFamily(clip.fontFamily, clip.text3d ? '800' : (preset.text as { fontWeight?: string } | undefined)?.fontWeight ?? clip.fontWeight),
            textAlign: clip.textAlign ?? 'center',
          },
          // a beépített fontoknak nincs dőlt változata: a render is döntött betűképet ad
          clip.fontStyle === 'italic' ? { transform: [{ skewX: '-12deg' }] } : null,
          clip.text3d ? null : preset.text,
          // 🔡 tipográfia (tracking/leading) + 🎨 stílus-közelítés (a pontos
          // gradient/kontúr a renderben ég be; itt a gradient a from-színnel,
          // a glow/shadow textShadow-val közelít)
          !clip.text3d
            ? {
                ...typo,
                // padding (nem eltolás): a sor fölé lógó betűrész (ékezet) a nézeten belül marad,
                // a negatív alsó margó a doboz méretét változatlanul hagyja
                ...(tightShift ? { paddingTop: tightShift, marginBottom: -tightShift } : null),
                ...(clip.textStyle?.gradient ? { color: clip.textStyle.gradient.from } : null),
                ...(clip.textStyle?.glow
                  ? {
                      textShadowColor: clip.textStyle.glow.color,
                      textShadowRadius: Math.max(4, clip.textStyle.glow.size * fontSize),
                      textShadowOffset: { width: 0, height: 0 },
                    }
                  : clip.textStyle?.shadow
                    ? {
                        textShadowColor: clip.textStyle.shadow.color,
                        textShadowRadius: Math.max(0, clip.textStyle.shadow.blur * fontSize),
                        textShadowOffset: {
                          width: clip.textStyle.shadow.dx * fontSize,
                          height: clip.textStyle.shadow.dy * fontSize,
                        },
                      }
                    : null),
              }
            : null,
        ]}
      >
        {karaokeWords
          ? karaokeWords.map((w, i) => (
              <Text
                allowFontScaling={false}
                key={i}
                style={[
                  w.state === 'active'
                    ? { color: palette.accent }
                    : w.state === 'next'
                      ? { opacity: 0.45 }
                      : null,
                  // 🧊 3D caption-közelítés: pink + nagyobb + mélység-árnyék
                  // (a valódi extrúzió+perspektíva a renderben ég be)
                  w.emp
                    ? {
                        color: '#ff2ea6',
                        fontWeight: '900',
                        fontSize:
                          fontSize * (w.state === 'active' ? 1.26 : 1.14),
                        opacity: w.state === 'next' ? 0.6 : 1,
                        textShadowColor: '#8f0f5c',
                        textShadowOffset: {
                          width: fontSize * 0.06,
                          height: fontSize * 0.06,
                        },
                        textShadowRadius: 1,
                      }
                    : null,
                ]}
              >
                {w.word}
                {i < karaokeWords!.length - 1 ? ' ' : ''}
              </Text>
            ))
          : shown}
      </Text>
    </>
  );
}
