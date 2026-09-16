#!/usr/bin/env node
/**
 * Verify Call Feature Setup
 * 
 * Checks that all required components for video/voice calls are properly configured.
 * Run this before building the APK to catch any issues.
 * 
 * Usage: node scripts/verify-call-setup.js
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let errors = 0;
let warnings = 0;

function check(condition, message, isWarning = false) {
  if (condition) {
    console.log(`✅ ${message}`);
    return true;
  } else {
    if (isWarning) {
      console.warn(`⚠️  ${message}`);
      warnings++;
    } else {
      console.error(`❌ ${message}`);
      errors++;
    }
    return false;
  }
}

function fileExists(filePath) {
  return fs.existsSync(path.join(root, filePath));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, filePath), 'utf8'));
  } catch {
    return null;
  }
}

function fileContains(filePath, text) {
  try {
    const content = fs.readFileSync(path.join(root, filePath), 'utf8');
    return content.includes(text);
  } catch {
    return false;
  }
}

console.log('\n═══════════════════════════════════════');
console.log('   Luvstor Call Feature Verification');
console.log('═══════════════════════════════════════\n');

// 1. Check package.json dependencies
console.log('📦 Checking Dependencies...');
const pkg = readJson('package.json');
check(pkg?.dependencies?.['react-native-webrtc'], 'react-native-webrtc installed');
check(pkg?.dependencies?.['socket.io-client'], 'socket.io-client installed');
check(pkg?.dependencies?.['expo-audio'], 'expo-audio installed');
check(
  pkg?.scripts?.postinstall?.includes('patch-webrtc-bridgeless.js'),
  'WebRTC bridgeless patch configured in postinstall'
);

// 2. Check core files exist
console.log('\n📁 Checking Core Files...');
check(fileExists('contexts/CallContext.tsx'), 'CallContext.tsx exists');
check(fileExists('components/call/CallOverlay.tsx'), 'CallOverlay.tsx exists');
check(fileExists('services/webrtc.ts'), 'webrtc.ts exists');
check(fileExists('app/calls.tsx'), 'Call history screen exists');
check(fileExists('plugins/withWebRTC.js'), 'WebRTC config plugin exists');
check(fileExists('scripts/patch-webrtc-bridgeless.js'), 'WebRTC patch script exists');

// 3. Check app.json configuration
console.log('\n⚙️  Checking app.json Configuration...');
const appConfig = readJson('app.json');
const androidPerms = appConfig?.expo?.android?.permissions || [];
check(androidPerms.includes('android.permission.CAMERA'), 'Android CAMERA permission');
check(androidPerms.includes('android.permission.RECORD_AUDIO'), 'Android RECORD_AUDIO permission');
check(androidPerms.includes('android.permission.MODIFY_AUDIO_SETTINGS'), 'Android MODIFY_AUDIO_SETTINGS permission');
check(androidPerms.includes('android.permission.BLUETOOTH'), 'Android BLUETOOTH permission');

const iosInfo = appConfig?.expo?.ios?.infoPlist || {};
check(iosInfo.NSCameraUsageDescription, 'iOS NSCameraUsageDescription');
check(iosInfo.NSMicrophoneUsageDescription, 'iOS NSMicrophoneUsageDescription');

const bgModes = iosInfo.UIBackgroundModes || [];
check(bgModes.includes('audio'), 'iOS background audio mode');
check(bgModes.includes('voip'), 'iOS VoIP background mode');

const plugins = appConfig?.expo?.plugins || [];
check(
  plugins.some(p => 
    (typeof p === 'string' && p.includes('withWebRTC')) ||
    (Array.isArray(p) && p[0]?.includes('withWebRTC'))
  ),
  'WebRTC plugin registered in app.json'
);

// 4. Check CallContext integration
console.log('\n🔌 Checking CallContext Integration...');
check(
  fileContains('contexts/CallContext.tsx', 'CallPeer') ||
  fileContains('services/webrtc.ts', 'react-native-webrtc'),
  'CallContext uses WebRTC (via CallPeer)'
);
check(
  fileContains('contexts/CallContext.tsx', 'startCall'),
  'CallContext implements startCall'
);
check(
  fileContains('contexts/CallContext.tsx', 'acceptCall'),
  'CallContext implements acceptCall'
);
check(
  fileContains('contexts/CallContext.tsx', 'toggleMute'),
  'CallContext implements toggleMute'
);
check(
  fileContains('contexts/CallContext.tsx', 'toggleCamera'),
  'CallContext implements toggleCamera'
);

// 5. Check CallOverlay UI
console.log('\n🎨 Checking CallOverlay UI...');
check(
  fileContains('components/call/CallOverlay.tsx', 'useCall'),
  'CallOverlay uses useCall hook'
);
check(
  fileContains('components/call/CallOverlay.tsx', 'acceptCall'),
  'CallOverlay has accept button'
);
check(
  fileContains('components/call/CallOverlay.tsx', 'declineCall'),
  'CallOverlay has decline button'
);
check(
  fileContains('components/call/CallOverlay.tsx', 'RTCView'),
  'CallOverlay renders video streams'
);

// 6. Check call buttons in messages
console.log('\n📱 Checking UI Integration...');
check(
  fileContains('app/messages/[id].tsx', 'startCall'),
  'Messages screen has call integration'
);
check(
  fileContains('app/messages/[id].tsx', 'videocam'),
  'Messages screen has video call button'
);
check(
  fileContains('app/calls.tsx', 'call'),
  'Call history screen exists'
);

// 7. Check Android project
console.log('\n🤖 Checking Android Project...');
check(fileExists('android/gradlew'), 'Android gradlew exists (native project ready)');
check(
  fileExists('android/app/build.gradle'),
  'Android app build.gradle exists',
  true
);

// 8. Check WebRTC patch was applied
console.log('\n🔧 Checking WebRTC Patches...');
const webrtcPath = path.join(root, 'node_modules', 'react-native-webrtc');
if (fs.existsSync(webrtcPath)) {
  check(
    fileExists('node_modules/react-native-webrtc/src/webrtcNative.ts'),
    'WebRTC bridgeless helper exists (patch applied)'
  );
} else {
  console.warn('⚠️  react-native-webrtc not in node_modules (run npm install)');
  warnings++;
}

// 9. Environment checks
console.log('\n🌐 Environment Checks...');
check(
  fileExists('../backend/services/calls.js'),
  'Backend call service exists',
  true
);
check(
  fileExists('../backend/socket/index.js') && 
  fileContains('../backend/socket/index.js', 'call:invite'),
  'Backend socket handlers exist',
  true
);

// Summary
console.log('\n═══════════════════════════════════════');
console.log('           Verification Results');
console.log('═══════════════════════════════════════\n');

if (errors === 0 && warnings === 0) {
  console.log('🎉 All checks passed! Call feature is fully configured.');
  console.log('\n✅ Next Steps:');
  console.log('   1. Build APK: npm run android:apk');
  console.log('   2. Install on 2 devices');
  console.log('   3. Test voice & video calls');
  console.log('\n📖 Documentation: See CALL_FEATURE_DOCUMENTATION.md\n');
  process.exit(0);
} else if (errors === 0) {
  console.log(`⚠️  All critical checks passed (${warnings} warnings)`);
  console.log('   Warnings are non-critical but should be addressed.\n');
  process.exit(0);
} else {
  console.error(`\n❌ ${errors} critical issue(s) found (${warnings} warnings)`);
  console.error('   Fix the errors above before building APK.\n');
  process.exit(1);
}
