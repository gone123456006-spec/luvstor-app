/**
 * WhatsApp-like call audio routing.
 *
 * Priority when the user has not forced a route:
 *   Bluetooth (headset mic + speakers) → wired headset →
 *   video: loudspeaker / voice: earpiece
 *
 * Speaker ON  → force loudspeaker
 * Speaker OFF → release force (mode 0) and re-select Bluetooth if present
 *
 * Uses react-native-incall-manager communication-audio APIs
 * (chooseAudioRoute / SCO). No Bluetooth scanning.
 */

import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type CallAudioRoute = 'bluetooth' | 'wired' | 'earpiece' | 'speaker';

export type CallAudioSnapshot = {
  available: CallAudioRoute[];
  selected: CallAudioRoute;
};

type InCallManagerModule = {
  start: (opts?: { media?: string; auto?: boolean; ringback?: string }) => void;
  stop: (opts?: { busytone?: string }) => void;
  setForceSpeakerphoneOn: (flag: boolean | null) => void;
  setSpeakerphoneOn: (enable: boolean) => void;
  setMicrophoneMute: (enable: boolean) => void;
  chooseAudioRoute?: (route: string) => void;
  startProximitySensor?: () => void;
  stopProximitySensor?: () => void;
  startRingback?: (ringback: string) => void;
  stopRingback?: () => void;
};

const NATIVE_ROUTE: Record<CallAudioRoute, string> = {
  bluetooth: 'BLUETOOTH',
  wired: 'WIRED_HEADSET',
  earpiece: 'EARPIECE',
  speaker: 'SPEAKER_PHONE',
};

let InCall: InCallManagerModule | null = null;
let inCallTried = false;
let ringbackPlayer: AudioPlayer | null = null;
let ringtonePlayer: AudioPlayer | null = null;
let deviceSub: { remove: () => void } | null = null;
let wiredSub: { remove: () => void } | null = null;

type Session = {
  active: boolean;
  callType: 'voice' | 'video';
  available: CallAudioRoute[];
  selected: CallAudioRoute;
  /** Explicit user pick — respected until the device disappears or they change it. */
  manual: CallAudioRoute | null;
};

const session: Session = {
  active: false,
  callType: 'voice',
  available: ['earpiece', 'speaker'],
  selected: 'earpiece',
  manual: null,
};

const listeners = new Set<(snap: CallAudioSnapshot) => void>();

function emitAudio() {
  const snap: CallAudioSnapshot = {
    available: [...session.available],
    selected: session.selected,
  };
  listeners.forEach((fn) => {
    try {
      fn(snap);
    } catch {
      /* ignore */
    }
  });
}

export function subscribeCallAudioDevices(
  fn: (snap: CallAudioSnapshot) => void,
): () => void {
  listeners.add(fn);
  fn({ available: [...session.available], selected: session.selected });
  return () => {
    listeners.delete(fn);
  };
}

export function getCallAudioSnapshot(): CallAudioSnapshot {
  return { available: [...session.available], selected: session.selected };
}

function getInCallManager(): InCallManagerModule | null {
  if (inCallTried) return InCall;
  inCallTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-incall-manager');
    const candidate = (mod?.default || mod) as InCallManagerModule | null;
    if (
      candidate &&
      typeof candidate.start === 'function' &&
      typeof candidate.stop === 'function'
    ) {
      InCall = candidate;
    } else {
      InCall = null;
    }
  } catch {
    InCall = null;
  }
  return InCall;
}

/** Drop broken native bridge after a failed call so we stay on expo-audio. */
function markInCallBroken() {
  InCall = null;
}

/**
 * InCallManager maps:
 *   true  →  1  force speaker
 *   false → -1  force speaker OFF (earpiece) — this kills Bluetooth SCO
 *   null  →  0  auto (system / Bluetooth / wired)
 */
function setSpeakerForce(mgr: InCallManagerModule, mode: 'on' | 'off' | 'auto') {
  try {
    if (mode === 'on') mgr.setForceSpeakerphoneOn(true);
    else if (mode === 'off') mgr.setForceSpeakerphoneOn(false);
    else mgr.setForceSpeakerphoneOn(null);
  } catch (err) {
    console.warn('[CallAudio] speaker force:', (err as Error).message);
  }
}

function chooseNativeRoute(mgr: InCallManagerModule, route: CallAudioRoute) {
  try {
    mgr.chooseAudioRoute?.(NATIVE_ROUTE[route]);
  } catch (err) {
    console.warn('[CallAudio] chooseAudioRoute:', (err as Error).message);
  }
}

function applyExpoForRoute(route: CallAudioRoute) {
  const throughEarpiece = route === 'earpiece';
  return setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
    // Only pin earpiece when that is the real destination.
    // true here after Speaker-off was blocking Bluetooth SCO restore.
    shouldRouteThroughEarpiece: throughEarpiece,
  }).catch((err) => {
    console.warn('[CallAudio] expo mode:', (err as Error).message);
  });
}

function applyNativeRoute(route: CallAudioRoute) {
  const mgr = getInCallManager();
  if (mgr) {
    try {
      if (route === 'speaker') {
        setSpeakerForce(mgr, 'on');
        chooseNativeRoute(mgr, 'speaker');
        mgr.setSpeakerphoneOn?.(true);
        mgr.stopProximitySensor?.();
      } else if (route === 'bluetooth') {
        // Release force so SCO can attach; then pick Bluetooth explicitly
        setSpeakerForce(mgr, 'auto');
        mgr.setSpeakerphoneOn?.(false);
        chooseNativeRoute(mgr, 'bluetooth');
        mgr.stopProximitySensor?.();
      } else if (route === 'wired') {
        setSpeakerForce(mgr, 'auto');
        mgr.setSpeakerphoneOn?.(false);
        chooseNativeRoute(mgr, 'wired');
        mgr.stopProximitySensor?.();
      } else {
        setSpeakerForce(mgr, 'off');
        chooseNativeRoute(mgr, 'earpiece');
        mgr.setSpeakerphoneOn?.(false);
        if (session.callType === 'voice') mgr.startProximitySensor?.();
        else mgr.stopProximitySensor?.();
      }
    } catch (err) {
      console.warn('[CallAudio] apply route:', (err as Error).message);
    }
  }
  void applyExpoForRoute(route);
}

function defaultRoute(
  available: CallAudioRoute[],
  callType: 'voice' | 'video',
): CallAudioRoute {
  if (available.includes('bluetooth')) return 'bluetooth';
  if (available.includes('wired')) return 'wired';
  return callType === 'video' ? 'speaker' : 'earpiece';
}

function uniqRoutes(list: CallAudioRoute[]): CallAudioRoute[] {
  const seen = new Set<CallAudioRoute>();
  const out: CallAudioRoute[] = [];
  for (const r of list) {
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

function parseDeviceName(raw: unknown): CallAudioRoute | null {
  const s = String(raw || '')
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!s || s === 'NONE') return null;
  if (s.includes('BLUETOOTH')) return 'bluetooth';
  if (s.includes('WIRED') || s === 'HEADSET' || s.includes('WIRED_HEADSET')) {
    return 'wired';
  }
  if (s.includes('SPEAKER')) return 'speaker';
  if (s.includes('EARPIECE') || s === 'EAR') return 'earpiece';
  return null;
}

function parseAvailable(list: unknown): CallAudioRoute[] {
  const raw = Array.isArray(list) ? list : [];
  const parsed = raw
    .map(parseDeviceName)
    .filter((r): r is CallAudioRoute => !!r);
  // Phone speaker is always a real output
  if (!parsed.includes('speaker')) parsed.push('speaker');
  // Earpiece is available unless a wired headset owns the receiver
  if (!parsed.includes('wired') && !parsed.includes('earpiece')) {
    parsed.push('earpiece');
  }
  return uniqRoutes(parsed);
}

function onDevicesChanged(available: CallAudioRoute[], selectedHint?: CallAudioRoute | null) {
  session.available = available.length ? available : ['earpiece', 'speaker'];

  if (session.manual && !session.available.includes(session.manual)) {
    session.manual = null;
  }

  if (!session.active) {
    emitAudio();
    return;
  }

  const wanted = session.manual || defaultRoute(session.available, session.callType);
  if (wanted !== session.selected) {
    session.selected = wanted;
    applyNativeRoute(wanted);
  } else if (selectedHint && selectedHint !== session.selected && !session.manual) {
    // Native already switched (BT connected mid-call) — follow it
    session.selected = selectedHint;
    applyNativeRoute(selectedHint);
  }
  emitAudio();
}

function bindDeviceListeners() {
  unbindDeviceListeners();

  const onAudioDevice = (event: any) => {
    const available = parseAvailable(event?.availableAudioDeviceList);
    const selected = parseDeviceName(event?.selectedAudioDevice);
    onDevicesChanged(available, selected);
  };
  const onWired = (event: any) => {
    const plugged = !!(event?.isPlugged ?? event?.plugged);
    const next = session.available.filter((r) => r !== 'wired');
    if (plugged) next.unshift('wired');
    onDevicesChanged(uniqRoutes(next));
  };

  try {
    deviceSub = DeviceEventEmitter.addListener('onAudioDeviceChanged', onAudioDevice);
  } catch {
    deviceSub = null;
  }
  try {
    wiredSub = DeviceEventEmitter.addListener('WiredHeadset', onWired);
  } catch {
    wiredSub = null;
  }

  // Some ICM builds emit via NativeEventEmitter only
  try {
    const native = NativeModules.InCallManager;
    if (native) {
      const emitter = new NativeEventEmitter(native);
      const a = emitter.addListener('onAudioDeviceChanged', onAudioDevice);
      const b = emitter.addListener('WiredHeadset', onWired);
      const prevDevice = deviceSub;
      const prevWired = wiredSub;
      deviceSub = {
        remove: () => {
          prevDevice?.remove();
          a.remove();
        },
      };
      wiredSub = {
        remove: () => {
          prevWired?.remove();
          b.remove();
        },
      };
    }
  } catch {
    /* DeviceEventEmitter is enough */
  }
}

function unbindDeviceListeners() {
  try {
    deviceSub?.remove();
  } catch {
    /* ignore */
  }
  try {
    wiredSub?.remove();
  } catch {
    /* ignore */
  }
  deviceSub = null;
  wiredSub = null;
}

/**
 * Start the native call audio session (ringing → connected).
 * preferSpeaker is the video default and is ignored when a headset is present.
 */
export async function startCallAudio(opts: {
  callType: 'voice' | 'video';
  speakerOn?: boolean;
  preferSpeaker?: boolean;
}): Promise<CallAudioRoute> {
  session.active = true;
  session.callType = opts.callType;
  session.manual = null;

  const preferSpeaker = opts.preferSpeaker ?? opts.speakerOn ?? opts.callType === 'video';

  const mgr = getInCallManager();
  if (mgr) {
    try {
      // auto:true — ICM communication mode + Bluetooth SCO when a headset exists
      mgr.start({
        media: opts.callType === 'video' ? 'video' : 'audio',
        auto: true,
      });
    } catch (err) {
      markInCallBroken();
      console.warn('[CallAudio] InCall start:', (err as Error).message);
    }
  }

  bindDeviceListeners();

  const initial = defaultRoute(session.available, opts.callType);
  const route =
    initial === 'bluetooth' || initial === 'wired'
      ? initial
      : preferSpeaker
        ? 'speaker'
        : 'earpiece';
  session.selected = route;
  if (preferSpeaker && route === 'speaker') session.manual = 'speaker';
  applyNativeRoute(route);
  emitAudio();
  return route;
}

/** Toggle loudspeaker. Off restores Bluetooth / wired / earpiece (auto). */
export async function setCallSpeaker(speakerOn: boolean): Promise<CallAudioRoute> {
  if (speakerOn) {
    session.manual = 'speaker';
    session.selected = 'speaker';
    if (!session.available.includes('speaker')) {
      session.available = uniqRoutes([...session.available, 'speaker']);
    }
    applyNativeRoute('speaker');
    emitAudio();
    return 'speaker';
  }

  session.manual = null;
  const next = defaultRoute(session.available, session.callType);
  session.selected = next;
  applyNativeRoute(next);
  // Events can lag after Speaker-on tore down SCO — try Bluetooth, then
  // fall back so we never end up with silence.
  if (next !== 'bluetooth') {
    const mgr = getInCallManager();
    if (mgr) {
      setSpeakerForce(mgr, 'auto');
      chooseNativeRoute(mgr, 'bluetooth');
      setTimeout(() => {
        if (!session.active || session.manual) return;
        if (session.available.includes('bluetooth')) {
          session.selected = 'bluetooth';
          applyNativeRoute('bluetooth');
          emitAudio();
          return;
        }
        applyNativeRoute(session.selected);
      }, 350);
    }
  }
  emitAudio();
  return session.selected;
}

/** User picked a specific output from the in-call selector. */
export async function setCallAudioRoute(route: CallAudioRoute): Promise<CallAudioRoute> {
  session.manual = route;
  session.selected = route;
  if (!session.available.includes(route)) {
    session.available = uniqRoutes([...session.available, route]);
  }
  applyNativeRoute(route);
  emitAudio();
  return route;
}

/** Hardware / InCall mute (in addition to WebRTC track.enabled). */
export function setCallMicMuted(muted: boolean) {
  const mgr = getInCallManager();
  if (!mgr) return;
  try {
    mgr.setMicrophoneMute?.(muted);
  } catch (err) {
    console.warn('[CallAudio] mic mute:', (err as Error).message);
  }
}

/** Tear down session when the call ends — does not disconnect the BT device. */
export async function stopCallAudio() {
  stopCallRingback();
  stopIncomingRingtone();
  unbindDeviceListeners();
  session.active = false;
  session.manual = null;
  session.selected = 'earpiece';
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.stopProximitySensor?.();
      // auto — do not force earpiece (that would drop SCO mid-cleanup)
      setSpeakerForce(mgr, 'auto');
      mgr.setMicrophoneMute?.(false);
      mgr.stop?.();
    } catch (err) {
      markInCallBroken();
      console.warn('[CallAudio] InCall stop:', (err as Error).message);
    }
  }
  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RTCAudioSession } = require('react-native-webrtc');
      RTCAudioSession?.audioSessionDidDeactivate?.();
    } catch {
      /* Expo Go / missing native */
    }
  }
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    /* ignore */
  }
  emitAudio();
}

/**
 * Outbound ringback — classic dual-tone (440+480 Hz) cadence like WhatsApp/PSTN.
 */
export async function startCallRingback(speakerOn = false) {
  stopCallRingback();
  stopIncomingRingtone();

  await applyExpoForRoute(speakerOn ? 'speaker' : session.selected || 'earpiece');

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('../assets/sounds/ringback.wav');
    const player = createAudioPlayer(source, { updateInterval: 500 });
    player.loop = true;
    player.volume = speakerOn ? 0.9 : 0.75;
    player.play();
    ringbackPlayer = player;
  } catch (err) {
    console.warn('[CallAudio] ringback asset:', (err as Error).message);
    try {
      getInCallManager()?.startRingback?.('_DEFAULT_');
    } catch (e2) {
      console.warn('[CallAudio] InCall ringback:', (e2 as Error).message);
    }
  }
}

export function stopCallRingback() {
  try {
    getInCallManager()?.stopRingback?.();
  } catch {
    /* ignore */
  }
  if (ringbackPlayer) {
    try {
      ringbackPlayer.pause();
      ringbackPlayer.remove();
    } catch {
      /* ignore */
    }
    ringbackPlayer = null;
  }
}

/** Incoming ringtone — loops on speaker while the call UI is up (WhatsApp-style). */
export async function startIncomingRingtone() {
  stopIncomingRingtone();
  stopCallRingback();

  await applyExpoForRoute('speaker');

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const source = require('../assets/sounds/ringtone.wav');
    const player = createAudioPlayer(source, { updateInterval: 500 });
    player.loop = true;
    player.volume = 1;
    player.play();
    ringtonePlayer = player;
  } catch (err) {
    console.warn('[CallAudio] ringtone asset:', (err as Error).message);
  }
}

export function stopIncomingRingtone() {
  if (ringtonePlayer) {
    try {
      ringtonePlayer.pause();
      ringtonePlayer.remove();
    } catch {
      /* ignore */
    }
    ringtonePlayer = null;
  }
}

/** Re-assert routing after WebRTC connects (it often overwrites the audio session). */
export async function reinforceCallAudio(speakerOn?: boolean) {
  stopCallRingback();
  stopIncomingRingtone();
  if (!session.active) return;
  if (speakerOn === true && session.manual === 'speaker') {
    applyNativeRoute('speaker');
    return;
  }
  const route = session.manual || defaultRoute(session.available, session.callType);
  session.selected = route;
  applyNativeRoute(route);
  emitAudio();
  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RTCAudioSession } = require('react-native-webrtc');
      RTCAudioSession?.audioSessionDidActivate?.();
    } catch {
      /* Expo Go / missing native */
    }
  }
}

/** Force a clean mic session for chat voice notes (after WebRTC / InCallManager). */
export async function prepareChatRecordingAudio() {
  stopCallRingback();
  stopIncomingRingtone();
  const mgr = getInCallManager();
  if (mgr) {
    try {
      // Unmute + loosen routing only — do NOT mgr.stop() here.
      // stop() can tear down the Android audio session and block AudioRecord.
      mgr.setMicrophoneMute?.(false);
      mgr.stopProximitySensor?.();
      setSpeakerForce(mgr, 'auto');
    } catch {
      /* ignore */
    }
  }
  if (Platform.OS === 'ios') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RTCAudioSession } = require('react-native-webrtc');
      RTCAudioSession?.audioSessionDidDeactivate?.();
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 40));
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  });
}

/** Restore normal chat playback after a voice note is finished. */
export async function restoreChatPlaybackAudio() {
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.setMicrophoneMute?.(false);
    } catch {
      /* ignore */
    }
  }
  try {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
  } catch {
    /* ignore */
  }
}
