/**
 * 🎧 A telefon kész keverésének kötése a projekthez („azt kapod, amit hallasz”). CSAK a kérésben
 * ténylegesen feltöltött `audioMix` fájl lehet — a kliens által a JSON-ben küldött útvonalat
 * eldobjuk, különben a render a worker gépének tetszőleges fájlját égethetné a kimenetbe.
 */
function bindAudioMix(project, fieldToFile) {
  delete project.audioMixUri;
  if (fieldToFile.has('audioMix')) {
    project.audioMixUri = fieldToFile.get('audioMix');
  }
  return project;
}

module.exports = { bindAudioMix };
