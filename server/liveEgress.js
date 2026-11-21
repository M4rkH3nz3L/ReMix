// 🎥 LiveKit Egress a workerben (LIVE.md Fázis E) — a felhasználó ENGEDÉLYEZETT
// RTMP-céljaira streameli az élő szobát (RoomComposite → fan-out). A stream-
// kulcsokat service_role-lal olvassa a live_destinations-ből (a kliens sosem
// küldi broadcast-csatornán). A tényleges egress LiveKit Cloud-ot vagy self-host
// egress-szolgáltatást igényel (a lokális `livekit-server --dev` NEM tud egresst)
// — enélkül 503-at ad vissza, nem omlik össze.
//
// A modulcsalád a server/egress/ alatt: clients (kliens-singletonok), vod (felvétel),
// tracking (költségkontroll + söprés), reconcile (állapot-egyeztetés), control (indítás/leállítás).
const { startEgress, stopEgress, egressConfigured } = require('./egress/control');
const { egressMinutes, countActiveEgress, sweepUserStale, stopStale, intEnv, sweepStaleEgress } = require('./egress/tracking');
const { reconcileLive } = require('./egress/reconcile');

module.exports = {
  startEgress,
  stopEgress,
  egressConfigured,
  sweepStaleEgress,
  reconcileLive,
  // tesztekhez exportált tiszta-ish segédek:
  egressMinutes,
  countActiveEgress,
  sweepUserStale,
  stopStale,
  intEnv,
};
