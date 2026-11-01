/** A rétegek hivatkozásai a most feltöltött fájlokra kötve (pure); a hiányzót a render jelzi. */
function bindUploadedMedia(doc, files, uriMap) {
  const fieldToFile = new Map((files ?? []).map((f) => [f.fieldname, f.path]));
  // 🔐 a dokumentum a klienstől jön: csak a most feltöltött fájl vagy távoli cím maradhat, különben
  // tetszőleges szerver-oldali útvonalat olvastatna a renderrel. A hiányzót a render jelzi.
  const bind = (uri) => {
    if (typeof uri !== 'string' || !uri) {
      return undefined;
    }
    const field = uriMap[uri];
    const file = field ? fieldToFile.get(field) : null;
    return file || (/^https?:\/\//i.test(uri) ? uri : undefined);
  };
  for (const layer of doc.layers ?? []) {
    for (const key of ['uri', 'imageUri', 'lut']) {
      if (layer[key]) {
        layer[key] = bind(layer[key]);
      }
    }
    if (layer.mask?.image) {
      layer.mask.image = bind(layer.mask.image);
    }
  }
}

module.exports = { bindUploadedMedia };
