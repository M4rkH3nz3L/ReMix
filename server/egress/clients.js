// 🎥 LiveKit Egress — a kliens-singletonok (Egress / RoomService / Supabase service_role) az env-ből.
const { loggedFetch } = require('../lib/caught');
const { EgressClient, RoomServiceClient } = require('livekit-server-sdk');
const { createClient } = require('@supabase/supabase-js');

const LIVEKIT_URL = (process.env.LIVEKIT_URL || '').trim();
const LIVEKIT_API_KEY = (process.env.LIVEKIT_API_KEY || '').trim();
const LIVEKIT_API_SECRET = (process.env.LIVEKIT_API_SECRET || '').trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

/** ws(s)://host:port → http(s)://host:port (az Egress-API HTTP-n megy). */
function egressHttpUrl() {
  return LIVEKIT_URL.replace(/^ws/, 'http');
}

let egressClient = null;
function getEgressClient() {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return null;
  }
  if (!egressClient) {
    egressClient = new EgressClient(egressHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return egressClient;
}

let roomClient = null;
function getRoomClient() {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    return null;
  }
  if (!roomClient) {
    roomClient = new RoomServiceClient(egressHttpUrl(), LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomClient;
}

let admin = null;
function getAdmin() {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return null;
  }
  if (!admin) {
    admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false }, global: { fetch: loggedFetch() } });
  }
  return admin;
}

module.exports = { getEgressClient, getRoomClient, getAdmin };
