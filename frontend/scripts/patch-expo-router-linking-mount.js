/**
 * Patch expo-router Android initial-link race (expo/expo#49378).
 *
 * On Android, Linking.getInitialURL() is a Promise. useLinking attaches a
 * .then during render that calls onUnhandledLinking → setState on
 * NavigationContainer. If the Promise resolves before commit, React warns:
 * "Can't perform a React state update on a component that hasn't mounted yet."
 *
 * Fix: defer onUnhandledLinking until after the hook's first effect (mounted).
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '..',
  'node_modules',
  'expo-router',
  'build',
  'fork',
  'useLinking.native.js',
);

if (!fs.existsSync(target)) {
  console.warn('⚠ expo-router useLinking.native.js missing — skip mount race patch');
  process.exit(0);
}

let src = fs.readFileSync(target, 'utf8');

if (src.includes('LUVSTOR_DEFER_UNHANDLED_LINKING')) {
  console.log('✔ expo-router useLinking mount-race patch already applied');
  process.exit(0);
}

const MARKER = 'LUVSTOR_DEFER_UNHANDLED_LINKING';

const insertAfter =
  'const getActionFromStateRef = (0, react_1.useRef)(getActionFromState);';

if (!src.includes(insertAfter)) {
  console.warn('⚠ expo-router useLinking shape changed — skip mount race patch');
  process.exit(0);
}

const deferBlock = `${insertAfter}
    // ${MARKER}: defer onUnhandledLinking until after mount (Android getInitialURL race)
    const linkingMountedRef = (0, react_1.useRef)(false);
    const pendingUnhandledLinkRef = (0, react_1.useRef)(null);
    const reportUnhandledLinking = (0, react_1.useCallback)((path) => {
        if (linkingMountedRef.current) {
            onUnhandledLinking(path);
        }
        else {
            pendingUnhandledLinkRef.current = path;
        }
    }, [onUnhandledLinking]);
    (0, react_1.useEffect)(() => {
        linkingMountedRef.current = true;
        if (pendingUnhandledLinkRef.current !== null) {
            const pending = pendingUnhandledLinkRef.current;
            pendingUnhandledLinkRef.current = null;
            onUnhandledLinking(pending);
        }
        return () => {
            linkingMountedRef.current = false;
        };
    }, [onUnhandledLinking]);`;

src = src.replace(insertAfter, deferBlock);

// Promise branch (Android)
src = src.replace(
  `                        if (typeof url === 'string') {
                            // If the link were handled, it gets cleared in NavigationContainer
                            onUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url));
                        }`,
  `                        if (typeof url === 'string') {
                            // If the link were handled, it gets cleared in NavigationContainer
                            reportUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url));
                        }`,
);

// Sync string branch
src = src.replace(
  `                else {
                    onUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url));
                }`,
  `                else {
                    reportUnhandledLinking((0, extractPathFromURL_1.extractExpoPathFromURL)(prefixes, url));
                }`,
);

if (!src.includes('reportUnhandledLinking')) {
  console.warn('⚠ expo-router useLinking replace failed — skip mount race patch');
  process.exit(0);
}

fs.writeFileSync(target, src);
console.log('✔ Patched expo-router useLinking.native.js (defer unhandled linking until mount)');
