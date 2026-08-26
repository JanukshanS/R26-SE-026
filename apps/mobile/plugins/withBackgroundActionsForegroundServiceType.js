const { withAndroidManifest } = require('expo/config-plugins');

// react-native-background-actions' own AndroidManifest.xml declares its service
// (com.asterinet.react.bgactions.RNBackgroundActionsTask) with no
// foregroundServiceType at all. Android 14 (API 34+) requires every foreground
// service to declare one, and rejects a mismatched type at runtime with
// "IllegalArgumentException: foregroundServiceType 0x00000001 is not a subset
// of foregroundServiceType attribute ... in service element of manifest file"
// the first time BackgroundService.start() runs — the library has no config
// option for this, so it has to be added via manifest merge.
//
// This plugin declares the SAME service (matched by fully-qualified name) in
// the app's own manifest with foregroundServiceType="dataSync" and
// tools:node="merge", so Android's manifest merger combines it with the
// library's declaration at build time instead of conflicting with it.
const SERVICE_NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const FOREGROUND_SERVICE_TYPE = 'dataSync';

function withBackgroundActionsForegroundServiceType(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      return config;
    }

    if (!Array.isArray(application.service)) {
      application.service = [];
    }

    let service = application.service.find(
      (s) => s.$?.['android:name'] === SERVICE_NAME
    );
    if (!service) {
      service = { $: { 'android:name': SERVICE_NAME } };
      application.service.push(service);
    }
    service.$['android:foregroundServiceType'] = FOREGROUND_SERVICE_TYPE;
    service.$['tools:node'] = 'merge';

    return config;
  });
}

module.exports = withBackgroundActionsForegroundServiceType;
