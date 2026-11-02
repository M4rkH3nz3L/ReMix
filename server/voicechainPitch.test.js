const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { audioFxChain } = require('./voicechain');

// A4: a hangmagasság nem függhet a forrás mintavételétől (48 kHz-en régen elcsúszott)
const peakHz = (file) => {
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'aresample=44100,astats=metadata=1:reset=0', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const crossings = Number(/Zero crossings rate: ([\d.]+)/.exec(out)?.[1]);
  return (crossings * 44100) / 2;
};
const seconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }));

describe('audioFxChain pitch', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitch-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each([44100, 48000, 96000])('+12 félhang %i Hz-es forráson egy oktávval feljebb, a hossz marad', (rate) => {
    const src = path.join(dir, `src${rate}.wav`);
    const out = path.join(dir, `out${rate}.wav`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${rate}:duration=2`, src]);
    const chain = audioFxChain({ pitchSemitones: 12 }).replace(/^,|,$/g, '');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-af', chain, out]);
    expect(peakHz(out)).toBeGreaterThan(860);
    expect(peakHz(out)).toBeLessThan(900);
    expect(Math.abs(seconds(out) - 2)).toBeLessThan(0.05);
  });
});
