/* 🔇 V8: JNI-híd a RemixRNNoise.h C-felülethez (expo.modules.remixrender.RNNoiseNative). */
#include <jni.h>
#include <stdint.h>
#include "RemixRNNoise.h"

JNIEXPORT jint JNICALL Java_expo_modules_remixrender_RNNoiseNative_load(JNIEnv *env, jclass cls, jbyteArray blob) {
  jsize len = (*env)->GetArrayLength(env, blob);
  jbyte *p = (*env)->GetByteArrayElements(env, blob, NULL);
  int rc = remix_rnnoise_load(p, (int)len);
  (*env)->ReleaseByteArrayElements(env, blob, p, JNI_ABORT);
  return rc;
}

JNIEXPORT jlong JNICALL Java_expo_modules_remixrender_RNNoiseNative_create(JNIEnv *env, jclass cls) {
  return (jlong)(intptr_t)remix_rnnoise_create();
}

JNIEXPORT jfloat JNICALL Java_expo_modules_remixrender_RNNoiseNative_process(JNIEnv *env, jclass cls, jlong st, jfloatArray in, jfloatArray out, jint frames) {
  jfloat *i = (*env)->GetFloatArrayElements(env, in, NULL);
  jfloat *o = (*env)->GetFloatArrayElements(env, out, NULL);
  float vad = remix_rnnoise_process((void *)(intptr_t)st, i, o, frames);
  (*env)->ReleaseFloatArrayElements(env, in, i, JNI_ABORT);
  (*env)->ReleaseFloatArrayElements(env, out, o, 0);
  return vad;
}

JNIEXPORT void JNICALL Java_expo_modules_remixrender_RNNoiseNative_destroy(JNIEnv *env, jclass cls, jlong st) {
  remix_rnnoise_destroy((void *)(intptr_t)st);
}

JNIEXPORT jint JNICALL Java_expo_modules_remixrender_RNNoiseNative_frameSize(JNIEnv *env, jclass cls) {
  return remix_rnnoise_frame_size();
}

JNIEXPORT jlong JNICALL Java_expo_modules_remixrender_RNNoiseNative_resamplerCreate(JNIEnv *env, jclass cls, jint up, jint down, jint half, jfloatArray table) {
  jfloat *t = (*env)->GetFloatArrayElements(env, table, NULL);
  void *r = remix_resampler_create(up, down, half, t);
  (*env)->ReleaseFloatArrayElements(env, table, t, JNI_ABORT);
  return (jlong)(intptr_t)r;
}

JNIEXPORT jint JNICALL Java_expo_modules_remixrender_RNNoiseNative_resamplerProcess(JNIEnv *env, jclass cls, jlong h, jfloatArray in, jint n, jfloatArray out) {
  jfloat *i = (*env)->GetFloatArrayElements(env, in, NULL);
  jfloat *o = (*env)->GetFloatArrayElements(env, out, NULL);
  jint cap = (*env)->GetArrayLength(env, out);
  int w = remix_resampler_process((void *)(intptr_t)h, i, n, o, cap);
  (*env)->ReleaseFloatArrayElements(env, in, i, JNI_ABORT);
  (*env)->ReleaseFloatArrayElements(env, out, o, 0);
  return w;
}

JNIEXPORT jint JNICALL Java_expo_modules_remixrender_RNNoiseNative_resamplerFlush(JNIEnv *env, jclass cls, jlong h, jfloatArray out) {
  jfloat *o = (*env)->GetFloatArrayElements(env, out, NULL);
  jint cap = (*env)->GetArrayLength(env, out);
  int w = remix_resampler_flush((void *)(intptr_t)h, o, cap);
  (*env)->ReleaseFloatArrayElements(env, out, o, 0);
  return w;
}

JNIEXPORT void JNICALL Java_expo_modules_remixrender_RNNoiseNative_resamplerDestroy(JNIEnv *env, jclass cls, jlong h) {
  remix_resampler_destroy((void *)(intptr_t)h);
}
