/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

declare const __dirname: string;

// a vászon a kész képet mutatja: a rendszer betűméret-beállítása az exportot nem érinti,
// ezért itt sem hathat (0,823-as iPhone-on a sablonok szövege 18%-kal keskenyebb volt)
describe('TextOverlay', () => {
  const source: string = fs.readFileSync(path.join(__dirname, 'TextOverlay.tsx'), 'utf8');

  it('minden Text kikapcsolja a rendszer-betűméretet', () => {
    const tags = source.match(/<(?:Animated\.)?Text\b[^>]*?(?=\n\s*[a-zA-Z]+=|\s|>)[\s\S]*?>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const tag of tags) {
      expect(tag).toContain('allowFontScaling={false}');
    }
  });
});
