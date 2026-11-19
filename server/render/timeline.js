// 🎞️ Idővonal-matek: sávok/klipek lekérdezése, projekt-hossz, szegmens forrás-ablaka, a vizuális
// sáv nem átfedő szegmensekre bontása. (A server/render.js-ből kiemelve, változatlan tartalommal.)

function trackOf(project, type) {
  return project.tracks.find((t) => t.type === type) ?? { clips: [] };
}

/** klipek több sávtípusból (v3 séma: music/voiceover/sfx; legacy: audio) */
function clipsOfTypes(project, types) {
  return project.tracks
    .filter((t) => types.includes(t.type))
    .flatMap((t) => t.clips);
}

function clipEnd(c) {
  return c.start + c.duration;
}

function projectDuration(project) {
  let max = 0;
  for (const track of project.tracks) {
    for (const c of track.clips) {
      max = Math.max(max, clipEnd(c));
    }
  }
  return max;
}

/**
 * ⏪ Egy szegmens forrás-ablaka (mp). Normál: előre, `trimIn + skip*speed`-től.
 * Reversed (audit §6.3): a klip forrás-szakaszát HÁTULRÓL — a szegmens-ablak
 * tükrözve, konzisztensen a kliens `sourceTimeAt`-tal (preview==render parity).
 * A tényleges megfordítást a hívó `reverse`/`areverse` filtere adja az ablakon belül.
 */
function segSourceWindow(clip, seg) {
  if (clip.reversed) {
    const srcStart = clip.trimIn + (clip.duration - seg.skip - seg.duration) * clip.speed;
    return { srcStart, srcEnd: srcStart + seg.duration * clip.speed };
  }
  const srcStart = clip.trimIn + seg.skip * clip.speed;
  return { srcStart, srcEnd: srcStart + seg.duration * clip.speed };
}

/**
 * A vizuális sáv felbontása nem átfedő szegmensekre (átfedésnél a későbbi
 * kezdetű klip győz), a lyukak fekete kitöltést kapnak.
 */
function visualSegments(project, total) {
  const clips = trackOf(project, 'video')
    .clips.slice()
    .sort((a, b) => a.start - b.start || clipEnd(a) - clipEnd(b));
  const segments = [];
  let cursor = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const next = clips[i + 1];
    const visStart = Math.max(clip.start, cursor);
    const visEnd = Math.min(clipEnd(clip), next ? next.start : Infinity);
    if (visEnd <= visStart) {
      continue; // teljesen takarásban
    }
    if (visStart > cursor) {
      segments.push({ kind: 'gap', duration: visStart - cursor });
    }
    segments.push({
      kind: clip.kind,
      clip,
      // a klip elejéből ennyit vágott le a takarás
      skip: visStart - clip.start,
      duration: visEnd - visStart,
    });
    cursor = visEnd;
  }
  if (cursor < total) {
    segments.push({ kind: 'gap', duration: total - cursor });
  }
  if (segments.length === 0) {
    segments.push({ kind: 'gap', duration: Math.max(total, 1) });
  }
  return segments;
}

module.exports = {
  trackOf,
  clipsOfTypes,
  clipEnd,
  projectDuration,
  segSourceWindow,
  visualSegments,
};
