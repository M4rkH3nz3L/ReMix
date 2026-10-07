package expo.modules.remixrender

/**
 * A `filterId` → szín-overlay presetek — **a `server/render.js` `FILTERS`
 * térképének tükre** (drawbox szín/opacity), hogy az eszközön-render és a
 * felhő-render ugyanazt a look-ot adja (Preview == Export paritás). A kliens-
 * előnézet (`src/constants/grades.ts` / filter-tint) UGYANEZEKET az értékeket
 * használja. Ha itt vagy ott változik egy érték, a másikat is frissíteni kell.
 */
object FilterPresets {
  data class Preset(val rgb: Int, val opacity: Float)

  private val MAP = mapOf(
    "warm" to Preset(0xff9d4d, 0.18f),
    "cool" to Preset(0x4d9dff, 0.18f),
    "mono" to Preset(0x808080, 0.45f),
    "vivid" to Preset(0xff2ea6, 0.10f),
    "fade" to Preset(0xd8d2c2, 0.25f),
    "night" to Preset(0x101040, 0.35f),
    "retro" to Preset(0xc9a24b, 0.22f),
    "sunset" to Preset(0xff6b4a, 0.20f),
    "forest" to Preset(0x2e8b57, 0.18f),
  )

  /** `null`, ha nincs szűrő (`none`) vagy ismeretlen id (→ felhő-render). */
  fun get(id: String?): Preset? = if (id == null || id == "none") null else MAP[id]
}
