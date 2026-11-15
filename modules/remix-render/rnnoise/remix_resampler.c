/* ⚡ ReMix: a `src/lib/streamResampler.ts` (StreamResampler) egy-csatornás C-tükre. A fázistáblát a JS adja át
   (Float32), az összegzés double-ben, ugyanabban a sorrendben → a kimenet bitre azonos a JS-ével. */
#include <stdlib.h>
#include <string.h>
#include <math.h>
#include "RemixRNNoise.h"

typedef struct {
  int up, down, half;
  float *table;   /* up × 2·half */
  float *buf;
  long bufStart, bufLen, bufCap;
  long outIndex, inTotal;
} Resampler;

void *remix_resampler_create(int up, int down, int half, const float *table) {
  Resampler *r = (Resampler *)calloc(1, sizeof(Resampler));
  if (!r) return NULL;
  r->up = up; r->down = down; r->half = half;
  r->table = (float *)malloc(sizeof(float) * (size_t)up * 2 * half);
  r->bufCap = 4096;
  r->buf = (float *)malloc(sizeof(float) * (size_t)r->bufCap);
  if (!r->table || !r->buf) { free(r->table); free(r->buf); free(r); return NULL; }
  memcpy(r->table, table, sizeof(float) * (size_t)up * 2 * half);
  return r;
}

static void append(Resampler *r, const float *x, int n) {
  if (r->bufLen + n > r->bufCap) {
    long cap = r->bufCap * 2 > r->bufLen + n ? r->bufCap * 2 : r->bufLen + n;
    r->buf = (float *)realloc(r->buf, sizeof(float) * (size_t)cap);
    r->bufCap = cap;
  }
  memcpy(r->buf + r->bufLen, x, sizeof(float) * (size_t)n);
  r->bufLen += n;
  r->inTotal += n;
}

static int drain(Resampler *r, long limitOut, int final, float *out, int cap) {
  int written = 0;
  const int taps = 2 * r->half;
  while (r->outIndex < limitOut && written < cap) {
    long long posNum = (long long)r->outIndex * r->down;
    long base = (long)(posNum / r->up);
    int phase = (int)(r->outIndex % r->up);
    long first = base - (r->half - 1);
    long last = base + r->half;
    if (!final && last >= r->bufStart + r->bufLen) break;
    const float *w = r->table + (size_t)phase * taps;
    double acc = 0;
    for (int k = 0; k < taps; k++) {
      long idx = first + k - r->bufStart;
      if (idx >= 0 && idx < r->bufLen) acc += (double)r->buf[idx] * (double)w[k];
    }
    out[written++] = (float)acc;
    r->outIndex++;
  }
  long keepFrom = (long)(((long long)r->outIndex * r->down) / r->up) - (r->half - 1);
  long drop = keepFrom - r->bufStart;
  if (drop > r->bufLen) drop = r->bufLen;
  if (drop > 0) {
    memmove(r->buf, r->buf + drop, sizeof(float) * (size_t)(r->bufLen - drop));
    r->bufStart += drop;
    r->bufLen -= drop;
  }
  return written;
}

int remix_resampler_process(void *h, const float *in, int n, float *out, int cap) {
  Resampler *r = (Resampler *)h;
  append(r, in, n);
  return drain(r, 0x7fffffffffffffffL, 0, out, cap);
}

int remix_resampler_flush(void *h, float *out, int cap) {
  Resampler *r = (Resampler *)h;
  long total = (long)llround((double)r->inTotal * r->up / r->down);
  return drain(r, total, 1, out, cap);
}

void remix_resampler_destroy(void *h) {
  Resampler *r = (Resampler *)h;
  if (!r) return;
  free(r->table);
  free(r->buf);
  free(r);
}
