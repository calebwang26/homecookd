// iOS keeps a snapshot of an app's launch screen in the app's own storage and, after an update, can keep
// showing the old one: 1.1 flashed 1.0's pot before the egg (Caleb, Nov 8, still after a restart), though
// build 18's own launch image is the egg. A launch storyboard under a name iOS hasn't seen has no old
// snapshot, so it draws the new one.
//
// expo-splash-screen writes ios/<app>/SplashScreen.storyboard, its project entry and UILaunchStoryboardName.
// This renames all three after every other mod has written its files (a finalized mod runs last), and its
// runtime (SplashScreenManager.swift) reads the name back from Info.plist. Pick a new NAME whenever the
// launch image changes, so phones updating from the old one don't keep its snapshot.
const fs = require('fs');
const path = require('path');
const { withFinalizedMod } = require('expo/config-plugins');

const OLD = 'SplashScreen';
const NAME = 'LaunchEgg';

/** The Info.plist with UILaunchStoryboardName set to NAME; null when the key isn't OLD (nothing to rename). */
function renamePlist(plist) {
  const re = new RegExp(`(<key>UILaunchStoryboardName</key>\\s*<string>)${OLD}(</string>)`);
  return re.test(plist) ? plist.replace(re, `$1${NAME}$2`) : null;
}

function withFreshLaunchScreen(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const root = config.modRequest.platformProjectRoot;
      const app = config.modRequest.projectName;
      const from = path.join(root, app, `${OLD}.storyboard`);
      if (!fs.existsSync(from)) return config; // already renamed (a second prebuild), or no splash screen
      const plistPath = path.join(root, app, 'Info.plist');
      const plist = renamePlist(fs.readFileSync(plistPath, 'utf8'));
      // A storyboard renamed under a plist that still names the old one would launch to a blank screen.
      if (!plist) throw new Error(`withFreshLaunchScreen: Info.plist doesn't launch from ${OLD}`);
      const pbxPath = path.join(root, `${app}.xcodeproj`, 'project.pbxproj');
      const pbx = fs.readFileSync(pbxPath, 'utf8');
      if (!pbx.includes(`${OLD}.storyboard`)) throw new Error(`withFreshLaunchScreen: ${OLD}.storyboard isn't in the Xcode project`);
      fs.renameSync(from, path.join(root, app, `${NAME}.storyboard`));
      fs.writeFileSync(pbxPath, pbx.split(`${OLD}.storyboard`).join(`${NAME}.storyboard`));
      fs.writeFileSync(plistPath, plist);
      return config;
    },
  ]);
}

module.exports = withFreshLaunchScreen;
module.exports.NAME = NAME;
module.exports.renamePlist = renamePlist;
