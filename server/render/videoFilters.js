// 🎨 Klip-szintű videó-szűrőláncok: szűrő-tint, képjavítás (adjust), grade, világítás, AI Select,
// mozgás/stabilizálás, arc-elmosás, matte, chroma-él, fade. (A server/render.js-ből kiemelve.)
//
// REFACTOR: homlokzat — a láncok a render/videoFiltersLib/ alatt (helyi-út őr / szín / régió-maszk / idő-mozgás);
// az exportok ugyanazok, ugyanabban a sorrendben, ugyanazokkal a függvény-objektumokkal.
const { localPathOnly } = require('./videoFiltersLib/localPath');
const { FILTERS, adjustChain, gradeChain, LIGHTING, lightingChain, filterDrawbox } = require('./videoFiltersLib/colorChains');
const { selectiveChain, faceBlurChain, matteChain, edgeChain } = require('./videoFiltersLib/regionChains');
const { motionChain, stabilizeChain, fadeFilters } = require('./videoFiltersLib/timeChains');

module.exports = {
  localPathOnly,
  FILTERS,
  adjustChain,
  gradeChain,
  LIGHTING,
  lightingChain,
  selectiveChain,
  motionChain,
  stabilizeChain,
  faceBlurChain,
  matteChain,
  edgeChain,
  filterDrawbox,
  fadeFilters,
};
