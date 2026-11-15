// 🔇 V8: AI-zajszűrés (RNNoise v0.2, xiph — BSD-3) — a modul egyetlen C-felülete (Swift és Android JNI).
// A súly-blob (DNNw) a modell-katalógusból jön; a hívó 48 kHz-es, ±1 skálájú mintákat ad.
#ifndef REMIX_RNNOISE_H
#define REMIX_RNNOISE_H

#ifdef __cplusplus
extern "C" {
#endif

/// a modell betöltése a blobból (a blob lemásolódik); 0 = siker
int remix_rnnoise_load(const void *blob, int len);
/// egy új zajszűrő-állapot (csatornánként egy); NULL, ha nincs betöltött modell
void *remix_rnnoise_create(void);
/// `frames` × 480 minta feldolgozása (±1 skála); visszatér: az átlagos beszéd-valószínűség (VAD)
float remix_rnnoise_process(void *state, const float *in, float *out, int frames);
void remix_rnnoise_destroy(void *state);
int remix_rnnoise_frame_size(void);

/// ⚡ egy-csatornás folyamatos átmintavételező (a JS StreamResampler bitre azonos tükre; a táblát a JS adja)
void *remix_resampler_create(int up, int down, int half, const float *table);
/// a bemenet hozzáadása és a kiszámolható kimenet (legfeljebb `cap`); vissza: a kiírt minták száma
int remix_resampler_process(void *r, const float *in, int n, float *out, int cap);
/// a bemenet vége: a maradék kimenet a pontos hosszig
int remix_resampler_flush(void *r, float *out, int cap);
void remix_resampler_destroy(void *r);

#ifdef __cplusplus
}
#endif

#endif
