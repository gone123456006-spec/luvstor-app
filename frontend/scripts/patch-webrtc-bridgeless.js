/**
 * Patch react-native-webrtc for Expo SDK 54 / RN bridgeless (new architecture).
 *
 * Under bridgeless mode, legacy modules often don't surface via NativeModules,
 * so `const { WebRTCModule } = NativeModules` is null and calls fail with a
 * false "Expo Go" error even in production APKs.
 *
 * Fix: resolve WebRTCModule via TurboModuleRegistry fallback everywhere.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'node_modules', 'react-native-webrtc');
if (!fs.existsSync(root)) {
  console.warn('⚠ react-native-webrtc not installed — skip bridgeless patch');
  process.exit(0);
}

const SRC_HELPER = `import { NativeModules, TurboModuleRegistry } from 'react-native';

/**
 * Bridgeless / New Architecture safe lookup.
 * Legacy NativeModules.WebRTCModule is often null; TurboModuleRegistry still has it.
 */
export function getWebRTCModule(): any {
  try {
    const fromNative = (NativeModules as any)?.WebRTCModule;
    if (fromNative != null) return fromNative;
  } catch {
    /* RN 0.80+ may throw while parsing WebRTCModule annotations */
  }
  try {
    return TurboModuleRegistry.get('WebRTCModule');
  } catch {
    return null;
  }
}

const WebRTCModule = getWebRTCModule();
export default WebRTCModule;
`;

const CJS_HELPER = `"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.getWebRTCModule = getWebRTCModule;
exports.default = void 0;

var _reactNative = require("react-native");

function getWebRTCModule() {
  try {
    var fromNative = _reactNative.NativeModules && _reactNative.NativeModules.WebRTCModule;
    if (fromNative != null) return fromNative;
  } catch (e) {
    /* RN 0.80+ may throw while parsing WebRTCModule annotations */
  }
  try {
    return _reactNative.TurboModuleRegistry.get("WebRTCModule");
  } catch (e) {
    return null;
  }
}

var WebRTCModule = getWebRTCModule();
exports.default = WebRTCModule;
`;

const ESM_HELPER = `import { NativeModules, TurboModuleRegistry } from 'react-native';

export function getWebRTCModule() {
  try {
    const fromNative = NativeModules?.WebRTCModule;
    if (fromNative != null) return fromNative;
  } catch {
    /* RN 0.80+ may throw while parsing WebRTCModule annotations */
  }
  try {
    return TurboModuleRegistry.get('WebRTCModule');
  } catch {
    return null;
  }
}

const WebRTCModule = getWebRTCModule();
export default WebRTCModule;
`;

function writeHelper(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function patchFile(file, kind) {
  if (!fs.existsSync(file)) return false;
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes("from './webrtcNative'") || src.includes("require(\"./webrtcNative\")")) {
    return false; // already patched
  }

  const base = path.basename(file);
  if (base === 'webrtcNative.ts' || base === 'webrtcNative.js') return false;

  let changed = false;

  if (kind === 'src') {
    // Remove NativeModules-only import usage for WebRTCModule destructure
    if (/const\s*\{\s*WebRTCModule\s*\}\s*=\s*NativeModules\s*;/.test(src)) {
      src = src.replace(
        /const\s*\{\s*WebRTCModule\s*\}\s*=\s*NativeModules\s*;/,
        "import WebRTCModule from './webrtcNative';",
      );
      // Clean unused NativeModules from import if no longer referenced
      if (!src.includes('NativeModules')) {
        src = src.replace(
          /import\s*\{([^}]+)\}\s*from\s*'react-native'\s*;/,
          (m, inner) => {
            const parts = inner
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && s !== 'NativeModules');
            if (!parts.length) return '';
            return `import { ${parts.join(', ')} } from 'react-native';`;
          },
        );
      } else {
        // Still used — keep NativeModules in import, drop only if WebRTCModule was sole reason
        src = src.replace(
          /import\s*\{\s*NativeModules\s*\}\s*from\s*'react-native'\s*;\s*\n/,
          '',
        );
      }
      changed = true;
    }

    // index.ts null check: use helper
    if (file.endsWith(`${path.sep}index.ts`) || file.endsWith('/index.ts')) {
      if (src.includes('WebRTCModule === null')) {
        src = src.replace(
          /if \(WebRTCModule === null\) \{/,
          'if (WebRTCModule == null) {',
        );
        changed = true;
      }
    }
  }

  if (kind === 'cjs') {
    const pattern =
      /const\s*\{\s*WebRTCModule\s*\}\s*=\s*_reactNative\.NativeModules\s*;/;
    if (pattern.test(src)) {
      src = src.replace(
        pattern,
        'var _webrtcNative = require("./webrtcNative");\nvar WebRTCModule = _webrtcNative.default;',
      );
      changed = true;
    }
    // index.js without _reactNative prefix sometimes
    const pattern2 =
      /const\s*\{\s*WebRTCModule\s*\}\s*=\s*NativeModules\s*;/;
    if (pattern2.test(src) && !src.includes('webrtcNative')) {
      src = src.replace(
        pattern2,
        'var _webrtcNative = require("./webrtcNative");\nvar WebRTCModule = _webrtcNative.default;',
      );
      changed = true;
    }
    if (src.includes('WebRTCModule === null')) {
      src = src.replace(
        /if \(WebRTCModule === null\) \{/,
        'if (WebRTCModule == null) {',
      );
      changed = true;
    }
  }

  if (kind === 'esm') {
    const pattern = /const\s*\{\s*WebRTCModule\s*\}\s*=\s*NativeModules\s*;/;
    if (pattern.test(src)) {
      src = src.replace(
        pattern,
        "import WebRTCModule from './webrtcNative';",
      );
      // Drop unused NativeModules import when possible
      if (!/\bNativeModules\b/.test(src.replace(/import WebRTCModule from '\.\/webrtcNative';/, ''))) {
        src = src.replace(
          /import\s*\{([^}]+)\}\s*from\s*'react-native'\s*;/,
          (m, inner) => {
            const parts = inner
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s && s !== 'NativeModules');
            if (!parts.length) return '';
            return `import { ${parts.join(', ')} } from 'react-native';`;
          },
        );
      }
      changed = true;
    }
    if (src.includes('WebRTCModule === null')) {
      src = src.replace(
        /if \(WebRTCModule === null\) \{/,
        'if (WebRTCModule == null) {',
      );
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(file, src);
  }
  return changed;
}

function walk(dir, kind) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) n += walk(full, kind);
    else if (/\.(ts|js)$/.test(name) && !name.endsWith('.map')) {
      if (patchFile(full, kind)) n += 1;
    }
  }
  return n;
}

writeHelper(path.join(root, 'src', 'webrtcNative.ts'), SRC_HELPER);
writeHelper(path.join(root, 'lib', 'commonjs', 'webrtcNative.js'), CJS_HELPER);
writeHelper(path.join(root, 'lib', 'module', 'webrtcNative.js'), ESM_HELPER);

// Fix TS 6 deprecation on package tsconfig (moduleResolution "node")
const pkgTsconfig = path.join(root, 'tsconfig.json');
// Stub out package tsconfig so IDE (TS 6) does not flag deprecated moduleResolution=node.
const fixedTsconfig = `{
  "files": [],
  "compilerOptions": {
    "skipLibCheck": true,
    "noEmit": true
  }
}
`;
if (fs.existsSync(pkgTsconfig)) {
  const current = fs.readFileSync(pkgTsconfig, 'utf8');
  if (!current.includes('"files": []') || current.includes('moduleResolution')) {
    fs.writeFileSync(pkgTsconfig, fixedTsconfig);
    console.log('✓ Patched react-native-webrtc/tsconfig.json (IDE-safe stub)');
  }
}

const patched =
  walk(path.join(root, 'src'), 'src') +
  walk(path.join(root, 'lib', 'commonjs'), 'cjs') +
  walk(path.join(root, 'lib', 'module'), 'esm');

console.log(
  patched
    ? `✓ Patched react-native-webrtc for bridgeless (${patched} files)`
    : '✓ react-native-webrtc bridgeless patch already applied',
);
