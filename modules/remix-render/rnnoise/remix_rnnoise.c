/* 🔇 ReMix-wrapper az RNNoise köré (lásd ../RemixRNNoise.h). */
#include <stdlib.h>
#include <string.h>
#include "rnnoise.h"
#include "RemixRNNoise.h"

static void *g_blob = NULL;
static RNNModel *g_model = NULL;

int remix_rnnoise_load(const void *blob, int len) {
  /* egyszer töltjük be: a meglévő állapotok a modellre hivatkoznak (nem szabadítható fel alattuk) */
  if (g_model) return 0;
  free(g_blob);
  g_blob = malloc((size_t)len);
  if (!g_blob) return 1;
  memcpy(g_blob, blob, (size_t)len);
  g_model = rnnoise_model_from_buffer(g_blob, len);
  return g_model ? 0 : 2;
}

void *remix_rnnoise_create(void) {
  return g_model ? (void *)rnnoise_create(g_model) : NULL;
}

float remix_rnnoise_process(void *state, const float *in, float *out, int frames) {
  const int n = rnnoise_get_frame_size();
  float buf[2048];
  double vad = 0;
  for (int f = 0; f < frames; f++) {
    for (int i = 0; i < n; i++) buf[i] = in[f * n + i] * 32768.f;
    vad += rnnoise_process_frame((DenoiseState *)state, buf, buf);
    for (int i = 0; i < n; i++) out[f * n + i] = buf[i] * (1.f / 32768.f);
  }
  return frames > 0 ? (float)(vad / frames) : 0.f;
}

void remix_rnnoise_destroy(void *state) {
  if (state) rnnoise_destroy((DenoiseState *)state);
}

int remix_rnnoise_frame_size(void) { return rnnoise_get_frame_size(); }
