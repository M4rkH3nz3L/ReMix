/** A `renderer.js` típusai a TypeScript-es kliens-tesztekhez. */
export type RendererNeeds = { chromium?: boolean; ffmpeg?: boolean | string };

export function chromiumPath(): string | null;
export function ffmpegVersion(): [number, number] | null;
export function missingRenderer(needs: RendererNeeds): string[];
export function describeIfRenderer(name: string, needs: RendererNeeds, fn: () => void): void;
/** `it` (és `.each`), ha minden megvan; különben átugró / CI-ben bukó változat */
export function itIfRenderer(needs: RendererNeeds): Pick<jest.It, 'each'> & ((name: string, fn?: jest.ProvidesCallback, timeout?: number) => void);
export function versionAtLeast(have: [number, number], want: string): boolean;
