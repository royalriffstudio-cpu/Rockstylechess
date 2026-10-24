// Sentry's wrapper of expo's default Metro config: adds the debug-id plumbing the source-map
// upload needs. Everything below still applies on top of it.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { withNativeWind } = require("nativewind/metro");

const config = getSentryExpoConfig(__dirname);

// Metro's file watcher/Haste map builder otherwise crawls the whole repo
// root by default, including new_ui/ (a separate self-contained Expo
// project with its own full node_modules tree, nested inside this one only
// as a UI-fusion reference) and server/ (a separate Node project). Both are
// large, irrelevant to this app's bundle, and this repo lives on an exFAT
// SD card -- crawling either one made the bundler hang for minutes.
const existingBlockList = Array.isArray(config.resolver.blockList) ? config.resolver.blockList : [config.resolver.blockList].filter(Boolean);
config.resolver.blockList = [...existingBlockList, /\/new_ui\/.*/, /\/server\/.*/];

module.exports = withNativeWind(config, { input: "./global.css" });
