import { File } from 'expo-file-system';

import { loadAudioApi } from '@/lib/audioApiGuard';
import type { FxState } from '@/lib/audioDsp';
import { logCaught } from '@/lib/logCaught';
import { mixRange, OFFLINE_SAMPLE_RATE, stretchJobs, withNormalizeGains, type DecodedSource, type OfflineMixPlan } from '@/lib/offlineMix';
import { stretchSegment } from '@/lib/offlineMixClient';

/**
 * 🎧 „AZT KAPOD, AMIT HALLASZ” — az előre renderelt előnézet. A telefon a lejátszófej ELŐTT
 * rövid szeletekben kikeveri a végső hangot UGYANAZZAL a kóddal, mint az exportot
 * (`offlineMixPlan` → `stretchJobs` → `mixRange`), és a natív hangmotor ezt az EGY sávot játssza:
 * a szeletek a hangórán mintapontosan egymás után ütemezett forrásokként szólnak (rés nélkül).
 * Ebből következik: a pan, a fade, az automáció és minden, ami az exportban szól, az
 * előnézetben is pontosan úgy szól; a sávok közti szinkron tökéletes (egy forrás); szerkesztés
 * után a még el nem indult szeletek újrakeverődnek (≤ ~0,25 s).
 *
 * A lejátszófej a hangórából jön (`position()`), nem fordítva.
 */

type AudioApi = NonNullable<Awaited<ReturnType<typeof loadAudioApi>>>;
type Ctx = InstanceType<AudioApi['AudioContext']>;
type SourceNode = ReturnType<Ctx['createBufferSource']>;

const SR = OFFLINE_SAMPLE_RATE;
/** egy szelet hossza (minta) — a szerkesztés legfeljebb ennyi + az indítási tartalék után hallható */
export const CHUNK_SAMPLES = Math.round(0.125 * SR);
/** ennyit keverünk előre a lejátszófej elé */
const AHEAD_SEC = 0.75;
/** az indításkori ütemezési tartalék (a natív szál ennyi idő alatt biztosan átveszi az első szeletet) */
const START_LEAD_SEC = 0.08;
/** szerkesztéskor csak az ennél később induló szeletek cserélődnek (a közelebbiek már a natív
 * szálé — mérve: 50 ms-os határnál egy újrakevert szelet 5 ms-ot késett, ami kattanás) */
const EDIT_LEAD_SEC = 0.1;
const FILL_MS = 40;

interface Scheduled {
  node: SourceNode;
  /** idővonal-minta, ahonnan a szelet szól */
  from: number;
}

class PreviewEngine {
  private api: AudioApi | null = null;
  private ctx: Ctx | null = null;
  private decoded = new Map<string, DecodedSource>();
  private decoding = new Map<string, Promise<void>>();
  private plan: OfflineMixPlan | null = null;
  private sources = new Map<string, DecodedSource>();
  private planSeq = 0;
  private playSeq = 0;
  /** a stúdió bekötötte (az óra a motorból jön) */
  private armed = false;
  /** 📞 a rendszer felfüggesztette a hangmotort (hívás, Siri): a transzport megáll */
  onInterrupted: (() => void) | null = null;
  private playing = false;
  /** a lejátszás kezdete: idővonal-minta és hangóra-idő */
  private startSample = 0;
  private startCtx = 0;
  /** a következő keverendő idővonal-minta */
  private nextSample = 0;
  private scheduled: Scheduled[] = [];
  /** 🎛️ a klip-effektek folytonos állapota (ugrásnál a `mixRange` bejáratja) */
  private fxState = new Map<string, FxState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private endSample = 0;
  /** 🧪 mérés: késve ütemezett szeletek (= hallható rés), a legkisebb előny, a cserék */
  private stats = { late: 0, minLeadMs: Infinity, replaced: 0, chunks: 0 };

  /** 🧪 füstteszt: a klipenkénti lejátszók útja (a még nem támogatott effektes projektek útja) */
  forceFallback = false;

  /** a motor elérhető-e (natív modul) */
  async available(): Promise<boolean> {
    if (!this.api) {
      this.api = await loadAudioApi();
      // 🎙️ az iOS hang-munkamenetet EGY helyen kezeljük: az expo-audio (lejátszás néma kapcsolónál
      // is, felvételnél rögzítő mód). Két kezelő összeakad: felvétel közben a motor saját módot
      // próbált állítani, és nem indult el („Failed to resume audio context”, mérve).
      try {
        this.api?.AudioManager.disableSessionManagement();
      } catch (caught) {
        logCaught('lib/previewEngine.ts:available', caught);
      }
    }
    return this.api !== null;
  }

  /** a hangóra szerinti lejátszófej (mp); álló motornál az utolsó helyzet */
  position(): number {
    if (!this.playing || !this.ctx) {
      return this.startSample / SR;
    }
    return Math.max(this.startSample / SR, this.startSample / SR + (this.ctx.currentTime - this.startCtx));
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** a motor hajtja-e az előnézetet (a stúdió `MixEngineLayer`-e kapcsolja) */
  arm(on: boolean): void {
    this.armed = on;
    if (!on) {
      this.pause();
    }
  }

  /**
   * ⏱️ A mesteróra forrása: bekötött motornál a hangóra szerinti lejátszófej (indításkor a
   * kezdőpont, amíg a hang el nem indul); különben null (a rAF-óra a saját lépésével halad).
   */
  clock(): number | null {
    return this.armed ? this.position() : null;
  }

  /**
   * Az új keverési terv (az exporté — a hívó a `mixForExport`+`offlineMixPlan`-t adja). A
   * hiányzó forrásokat dekódolja, a nyújtandókat elkészíti; futó lejátszásnál a még el nem
   * indult szeletek az új tervvel keverődnek újra.
   */
  async setPlan(raw: OfflineMixPlan | null): Promise<void> {
    const seq = ++this.planSeq;
    if (!raw || !(await this.available())) {
      this.plan = null;
      return;
    }
    const api = this.api!;
    await Promise.all([...new Set(raw.clips.map((c) => c.uri))].map((uri) => this.decode(api, uri)));
    const { jobs, plan } = stretchJobs(raw);
    const sources = new Map<string, DecodedSource>();
    for (const c of raw.clips) {
      const d = this.decoded.get(c.uri);
      if (d) sources.set(c.uri, d);
    }
    for (const job of jobs) {
      const src = this.decoded.get(job.uri);
      const done = this.sources.get(job.key);
      if (done) {
        sources.set(job.key, done);
      } else if (src) {
        sources.set(job.key, await stretchSegment(api, src, job));
      }
    }
    if (seq !== this.planSeq) {
      return; // közben újabb terv jött
    }
    // 📏 a normalizálás erősítése (ugyanaz az előmenet, mint az exportban)
    this.plan = withNormalizeGains(plan, sources);
    this.sources = sources;
    this.endSample = Math.round(plan.duration * SR);
    if (this.playing) {
      this.rescheduleFrom(this.position() + EDIT_LEAD_SEC);
    }
  }

  private decode(api: AudioApi, uri: string): Promise<void> {
    if (this.decoded.has(uri)) {
      return Promise.resolve();
    }
    const running = this.decoding.get(uri);
    if (running) {
      return running;
    }
    const task = (async () => {
      try {
        if (uri.startsWith('file:') && !new File(uri).exists) {
          return; // hiányzó fájl (újracsatolásra vár): a klip néma, nem hiba
        }
        const buf = await api.decodeAudioData(uri, SR);
        const channels = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
        this.decoded.set(uri, { channels, sampleRate: buf.sampleRate });
      } catch (caught) {
        logCaught('lib/previewEngine.ts:decode', caught);
      } finally {
        this.decoding.delete(uri);
      }
    })();
    this.decoding.set(uri, task);
    return task;
  }

  /** a felszabadítható dekódolt források (a tervben már nem szereplők) */
  forget(keepUris: Set<string>): void {
    for (const uri of this.decoded.keys()) {
      if (!keepUris.has(uri)) this.decoded.delete(uri);
    }
  }

  async play(fromSec: number): Promise<void> {
    if (!(await this.available())) {
      return;
    }
    // a kezdőpont AZONNAL érvényes (az ébresztés alatt a lejátszófej itt áll, nem a régi helyen)
    this.stopNodes(0);
    this.playing = false;
    this.startSample = Math.round(fromSec * SR);
    const seq = ++this.playSeq;
    if (!this.ctx) {
      this.ctx = new this.api!.AudioContext({ sampleRate: SR });
    }
    await this.ctx.resume();
    if (seq !== this.playSeq) {
      return; // közben újabb indítás vagy szünet jött
    }
    this.playing = true;
    this.startCtx = this.ctx.currentTime + START_LEAD_SEC;
    this.nextSample = this.startSample;
    this.fill();
    this.timer = this.timer ?? setInterval(() => this.fill(), FILL_MS);
  }

  pause(): void {
    this.playSeq += 1;
    const pos = this.position();
    this.playing = false;
    this.stopNodes(0);
    this.startSample = Math.round(pos * SR);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** ugrás futás közben: a teljes ütemezés újraindul az új helyről */
  seek(sec: number): void {
    if (this.playing) {
      void this.play(sec);
    } else {
      this.startSample = Math.round(sec * SR);
    }
  }

  private ctxTimeOf(sample: number): number {
    return this.startCtx + (sample - this.startSample) / SR;
  }

  /** a `fromSec` után induló szeletek cseréje (szerkesztés futás közben) */
  private rescheduleFrom(fromSec: number): void {
    const cut = Math.max(this.startSample, Math.ceil(fromSec * SR));
    // a `cut` ELŐTT induló szeletek végig szólnak; csak az utána indulók cserélődnek
    const keep = this.scheduled.filter((s) => s.from < cut);
    const drop = this.scheduled.filter((s) => !keep.includes(s));
    for (const s of drop) {
      try {
        s.node.stop(0);
      } catch (caught) {
        logCaught('lib/previewEngine.ts:reschedule', caught);
      }
    }
    this.stats.replaced += drop.length;
    this.scheduled = keep;
    this.nextSample = keep.length > 0 ? keep[keep.length - 1].from + CHUNK_SAMPLES : cut;
    this.fill();
  }

  private stopNodes(when: number): void {
    for (const s of this.scheduled) {
      try {
        s.node.stop(when);
      } catch (caught) {
        logCaught('lib/previewEngine.ts:stopNodes', caught);
      }
    }
    this.scheduled = [];
  }

  private fill(): void {
    const ctx = this.ctx;
    if (!this.playing || !ctx) {
      return;
    }
    // 📞 hívás / Siri: az iOS felfüggeszti a hangmotort (az óra áll) — a transzport is megáll
    if (ctx.state !== 'running') {
      this.pause();
      this.onInterrupted?.();
      return;
    }
    // a lejátszott szeletek kiesnek a listából
    const now = ctx.currentTime;
    this.scheduled = this.scheduled.filter((s) => this.ctxTimeOf(s.from + CHUNK_SAMPLES) > now);
    const until = Math.round((this.position() + AHEAD_SEC) * SR);
    while (this.nextSample < until && this.nextSample < this.endSample) {
      const from = this.nextSample;
      const to = Math.min(from + CHUNK_SAMPLES, this.endSample);
      const out: [Float32Array, Float32Array] = [new Float32Array(to - from), new Float32Array(to - from)];
      if (this.plan) {
        mixRange(this.plan, this.sources, out, from, to, 1, this.fxState);
      }
      const buf = ctx.createBuffer(2, to - from, SR);
      buf.copyToChannel(out[0] as Float32Array<ArrayBuffer>, 0);
      buf.copyToChannel(out[1] as Float32Array<ArrayBuffer>, 1);
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      // a késve ütemezett szelet (pl. akadás után) a hátralévő részével indul — a hangóra a mérvadó
      const at = this.ctxTimeOf(from);
      const late = Math.max(0, now - at);
      this.stats.chunks += 1;
      this.stats.minLeadMs = Math.min(this.stats.minLeadMs, (at - now) * 1000);
      if (late > 0) this.stats.late += 1;
      node.start(Math.max(at, now), late);
      this.scheduled.push({ node, from });
      this.nextSample = to;
    }
  }

  /** 🧪 füstteszt: a rendszer-megszakítás hatása (ugyanaz a felfüggesztés, amit az iOS tesz) */
  async debugSuspend(): Promise<void> {
    await this.ctx?.suspend();
  }

  /** 🧪 füstteszt: az ütemezés mérőszámai (a nullázás a lekérdezéssel) */
  takeStats(): { late: number; minLeadMs: number; replaced: number; chunks: number } {
    const out = this.stats;
    this.stats = { late: 0, minLeadMs: Infinity, replaced: 0, chunks: 0 };
    return out;
  }
}

export const previewEngine = new PreviewEngine();
