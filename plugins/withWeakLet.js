const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * CNG-biztos Podfile-hook: az Expo SDK 57 moduljai (pl. ExpoModulesJSI) `weak let`-et
 * használnak (SE-0481). A podspecjeik swift_version '6.0'-t deklarálnak, ezért régebbi
 * Swift-fordítón a WeakLet upcoming-feature ki van kapcsolva és a build elhasal.
 * Ezt a post_install minden pod-targetre bekapcsolja (ahol nem kell, no-op/warning).
 *
 * Korábban kézzel szerkesztett ios/Podfile-ban élt — a prebuild --clean elvitte. Így
 * config-pluginként túléli a natív regenerálást (WebRTC/LiveKit prebuild stb.).
 */
const SNIPPET = `
    # [withWeakLet] Expo SDK 57 'weak let' (SE-0481) — enable for every pod target.
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        flags = config.build_settings['OTHER_SWIFT_FLAGS'] || '$(inherited)'
        flags = flags.join(' ') if flags.is_a?(Array)
        unless flags.include?('WeakLet')
          config.build_settings['OTHER_SWIFT_FLAGS'] = "#{flags} -enable-upcoming-feature WeakLet"
        end
      end
    end
`;

module.exports = function withWeakLet(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes('WeakLet')) {
        contents = contents.replace(/post_install do \|installer\|\n/, (m) => m + SNIPPET);
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
