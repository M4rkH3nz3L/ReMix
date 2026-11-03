// 🚦 Párhuzamossági korlát a nehéz menetekhez (PRO-AUDIO A37): legfeljebb `max` futhat
// egyszerre, és egy kulcs (felhasználó) egyszerre csak egyet indíthat. A rate limit az
// indítások számát fogja, ez a CPU-t: egy 20 perces Demucs-menet ne fusson tucatszor.

function createSlotLimiter(max) {
  let used = 0;
  const holders = new Set();
  return {
    /** foglalás; `null`, ha nincs szabad hely vagy a kulcsnak már fut egy menete */
    tryAcquire(key) {
      if (used >= max || (key && holders.has(key))) {
        return null;
      }
      used += 1;
      if (key) {
        holders.add(key);
      }
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        used -= 1;
        if (key) {
          holders.delete(key);
        }
      };
    },
    get inUse() {
      return used;
    },
  };
}

module.exports = { createSlotLimiter };
