/**
 * Call audio: Android uses the native LuvstorCallAudio module
 * (AudioManager MODE_IN_COMMUNICATION + setCommunicationDevice / SCO).
 * iOS uses InCallManager. JS never invents routes or fights those managers.
 */

import {
  DeviceEventEmitter,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type CallAudioRoute = 'bluetooth' | 'wired' | 'earpiece' | 'speaker';

export type CallAudioSnapshot = {
  available: CallAudioRoute[];
  selected: CallAudioRoute;
};

type NativeCallAudio = {
  start: (
    callType: string,
    preferSpeaker: boolean,
  ) => Promise<{ available: string[]; selected: string }>;
  stop: () => Promise<boolean>;
  setSpeaker: (on: boolean) => Promise<{ available: string[]; selected: string }>;
  setRoute: (route: string) => Promise<{ available: string[]; selected: string }>;
  setMuted: (muted: boolean) => Promise<boolean>;
  reassert: () => Promise<{ available: string[]; selected: string }>;
  getSnapshot: () => Promise<{ available: string[]; selected: string }>;
  addListener: (eventName: string) => void;
  removeListeners: (count: number) => void;
};

type InCallManagerModule = {
  start: (opts?: { media?: string; auto?: boolean; ringback?: string }) => void;
  stop: (opts?: { busytone?: string }) => void;
  setForceSpeakerphoneOn: (flag: boolean | null) => void;
  setSpeakerphoneOn: (enable: boolean) => void;
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
let nativeSub: { remove: () => void } | null = null;

type Session = {
  active: boolean;
  callType: 'voice' | 'video';
  available: CallAudioRoute[];
  selected: CallAudioRoute;
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

function getNativeCallAudio(): NativeCallAudio | null {
  if (Platform.OS !== 'android') return null;
  const mod = NativeModules.LuvstorCallAudio as NativeCallAudio | undefined;
  return mod && typeof mod.start === 'function' ? mod : null;
}

function getInCallManager(): InCallManagerModule | null {
  // Android: native LuvstorCallAudio is the only manager when present.
  if (getNativeCallAudio()) return null;
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
    }
  } catch {
    InCall = null;
  }
  return InCall;
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

function applyNativeSnapshot(raw: { available?: string[]; selected?: string } | null) {
  if (!raw) return;
  const available = uniqRoutes(
    (raw.available || [])
      .map(parseDeviceName)
      .filter((r): r is CallAudioRoute => !!r),
  );
  const selected = parseDeviceName(raw.selected);
  if (available.length) session.available = available;
  if (selected && (!available.length || available.includes(selected))) {
    session.selected = selected;
    if (selected === 'speaker') session.manual = 'speaker';
    else if (session.manual === 'speaker' && selected !== 'speaker') {
      session.manual = null;
    }
  }
  emitAudio();
}

async function requestBluetoothConnect() {
  try {
    const { requestBluetoothConnect: request } = require('./appPermissions');
    await request();
  } catch {
    /* listing devices may still work for built-in routes */
  }
}

function applyIosRoute(route: CallAudioRoute) {
  const mgr = getInCallManager();
  if (!mgr) return;
  try {
    if (route === 'speaker') {
      mgr.setForceSpeakerphoneOn(true);
      mgr.chooseAudioRoute?.(NATIVE_ROUTE.speaker);
      mgr.stopProximitySensor?.();
      return;
    }
    // null = auto. false would force earpiece and drop Bluetooth.
    mgr.setForceSpeakerphoneOn(null);
    mgr.chooseAudioRoute?.(NATIVE_ROUTE[route]);
    if (route === 'earpiece' && session.callType === 'voice') {
      mgr.startProximitySensor?.();
    } else {
      mgr.stopProximitySensor?.();
    }
  } catch (err) {
    console.warn('[CallAudio] iOS route:', (err as Error).message);
  }
}

function bindNativeEvents() {
  unbindDeviceListeners();
  const native = getNativeCallAudio();
  if (native) {
    const onNative = (event: any) => applyNativeSnapshot(event);
    const jsSub = DeviceEventEmitter.addListener('luvstor_call_audio', onNative);
    let emitterSub: { remove: () => void } | null = null;
    try {
      const emitter = new NativeEventEmitter(native as any);
      emitterSub = emitter.addListener('luvstor_call_audio', onNative);
    } catch {
      emitterSub = null;
    }
    nativeSub = {
      remove: () => {
        jsSub.remove();
        emitterSub?.remove();
      },
    };
    return;
  }

  if (Platform.OS !== 'ios') return;
  const onAudioDevice = (event: any) => {
    const raw = Array.isArray(event?.availableAudioDeviceList)
      ? event.availableAudioDeviceList
      : [];
    const available = uniqRoutes(
      raw.map(parseDeviceName).filter((r): r is CallAudioRoute => !!r),
    );
    if (!available.includes('speaker')) available.push('speaker');
    if (!available.includes('wired') && !available.includes('earpiece')) {
      available.push('earpiece');
    }
    session.available = available;
    const selected = parseDeviceName(event?.selectedAudioDevice);
    if (selected && available.includes(selected) && session.manual !== 'speaker') {
      session.selected = selected;
    } else if (session.manual && !available.includes(session.manual)) {
      session.manual = null;
      const next = available.includes('bluetooth')
        ? 'bluetooth'
        : available.includes('wired')
          ? 'wired'
          : session.callType === 'video'
            ? 'speaker'
            : 'earpiece';
      session.selected = next;
      applyIosRoute(next);
    }
    emitAudio();
  };
  try {
    const nativeIcm = NativeModules.InCallManager;
    if (nativeIcm) {
      const emitter = new NativeEventEmitter(nativeIcm);
      deviceSub = emitter.addListener('onAudioDeviceChanged', onAudioDevice);
    }
  } catch {
    deviceSub = null;
  }
}

function unbindDeviceListeners() {
  try {
    deviceSub?.remove();
  } catch {
    /* ignore */
  }
  try {
    nativeSub?.remove();
  } catch {
    /* ignore */
  }
  deviceSub = null;
  nativeSub = null;
}

/** Start the native call audio session (ringing → connected). */
export async function startCallAudio(opts: {
  callType: 'voice' | 'video';
  speakerOn?: boolean;
  preferSpeaker?: boolean;
}): Promise<CallAudioRoute> {
  const preferSpeaker = opts.preferSpeaker ?? opts.speakerOn ?? opts.callType === 'video';
  session.callType = opts.callType;

  const native = getNativeCallAudio();
  if (native) {
    await requestBluetoothConnect();
    bindNativeEvents();
    if (session.active) {
      try {
        applyNativeSnapshot(await native.reassert());
      } catch {
        /* keep last snapshot */
      }
      return session.selected;
    }
    session.active = true;
    session.manual = null;
    try {
      applyNativeSnapshot(await native.start(opts.callType, preferSpeaker));
    } catch (err) {
      console.warn('[CallAudio] native start:', (err as Error).message);
      session.selected = preferSpeaker ? 'speaker' : 'earpiece';
    }
    emitAudio();
    return session.selected;
  }

  session.active = true;
  session.manual = null;
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.start({
        media: opts.callType === 'video' ? 'video' : 'audio',
        auto: true,
      });
    } catch (err) {
      console.warn('[CallAudio] InCall start:', (err as Error).message);
    }
  }
  bindNativeEvents();
  const route = preferSpeaker ? 'speaker' : 'earpiece';
  session.selected = route;
  if (preferSpeaker) session.manual = 'speaker';
  applyIosRoute(route);
  emitAudio();
  return route;
}

/** Toggle loudspeaker. Off restores Bluetooth / wired / earpiece. Does not unpair BT. */
export async function setCallSpeaker(speakerOn: boolean): Promise<CallAudioRoute> {
  const native = getNativeCallAudio();
  if (native && session.active) {
    session.manual = speakerOn ? 'speaker' : null;
    try {
      applyNativeSnapshot(await native.setSpeaker(speakerOn));
    } catch (err) {
      console.warn('[CallAudio] native speaker:', (err as Error).message);
    }
    return session.selected;
  }

  session.manual = speakerOn ? 'speaker' : null;
  if (speakerOn) {
    session.selected = 'speaker';
    if (!session.available.includes('speaker')) {
      session.available = uniqRoutes([...session.available, 'speaker']);
    }
    applyIosRoute('speaker');
  } else {
    const next = session.available.includes('bluetooth')
      ? 'bluetooth'
      : session.available.includes('wired')
        ? 'wired'
        : session.callType === 'video'
          ? 'speaker'
          : 'earpiece';
    session.selected = next;
    applyIosRoute(next);
  }
  emitAudio();
  return session.selected;
}

export async function setCallAudioRoute(route: CallAudioRoute): Promise<CallAudioRoute> {
  session.manual = route === 'speaker' ? 'speaker' : route;
  const native = getNativeCallAudio();
  if (native && session.active) {
    try {
      applyNativeSnapshot(await native.setRoute(route));
    } catch (err) {
      console.warn('[CallAudio] native route:', (err as Error).message);
    }
    return session.selected;
  }
  session.selected = route;
  if (!session.available.includes(route)) {
    session.available = uniqRoutes([...session.available, route]);
  }
  applyIosRoute(route);
  emitAudio();
  return route;
}

/** Mute is WebRTC-track + hardware flag only. Never changes Bluetooth routing. */
export function setCallMicMuted(muted: boolean) {
  const native = getNativeCallAudio();
  if (native) {
    native.setMuted(muted).catch((err) => {
      console.warn('[CallAudio] native mute:', (err as Error).message);
    });
  }
}

export async function stopCallAudio() {
  stopCallRingback();
  stopIncomingRingtone();
  unbindDeviceListeners();
  session.active = false;
  session.manual = null;
  session.selected = 'earpiece';
  const native = getNativeCallAudio();
  if (native) {
    try {
      await native.stop();
    } catch (err) {
      console.warn('[CallAudio] native stop:', (err as Error).message);
    }
  } else {
    const mgr = getInCallManager();
    if (mgr) {
      try {
        mgr.stopProximitySensor?.();
        mgr.setForceSpeakerphoneOn(null);
        mgr.stop?.();
      } catch (err) {
        console.warn('[CallAudio] InCall stop:', (err as Error).message);
      }
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

export async function startCallRingback(speakerOn = false) {
  stopCallRingback();
  stopIncomingRingtone();
  if (Platform.OS !== 'android' || !session.active) {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      /* ignore */
    }
  }

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
    if (Platform.OS !== 'android') {
      try {
        getInCallManager()?.startRingback?.('_DEFAULT_');
      } catch (e2) {
        console.warn('[CallAudio] InCall ringback:', (e2 as Error).message);
      }
    }
  }
}

export function stopCallRingback() {
  if (Platform.OS !== 'android') {
    try {
      getInCallManager()?.stopRingback?.();
    } catch {
      /* ignore */
    }
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

export async function startIncomingRingtone() {
  stopIncomingRingtone();
  stopCallRingback();
  if (Platform.OS !== 'android') {
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
        shouldRouteThroughEarpiece: false,
      });
    } catch {
      /* ignore */
    }
  }

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

/** Re-assert native routing after WebRTC connects. Does not change speaker/mute/BT. */
export async function reinforceCallAudio(_speakerOn?: boolean) {
  stopCallRingback();
  stopIncomingRingtone();
  if (!session.active) return;
  const native = getNativeCallAudio();
  if (native) {
    try {
      applyNativeSnapshot(await native.reassert());
    } catch (err) {
      console.warn('[CallAudio] native reassert:', (err as Error).message);
    }
    return;
  }
  applyIosRoute(session.selected);
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

export async function prepareChatRecordingAudio() {
  stopCallRingback();
  stopIncomingRingtone();
  if (session.active) return;
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'doNotMix',
    shouldRouteThroughEarpiece: false,
  });
}

export async function restoreChatPlaybackAudio() {
  if (session.active) return;
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
