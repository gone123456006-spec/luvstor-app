/**
 * Call audio session — speaker / earpiece / mute + WhatsApp-style ringback.
 * Prefers react-native-incall-manager when linked; falls back to expo-audio.
 */

import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

type InCallManagerModule = {
  start: (opts?: { media?: string; auto?: boolean; ringback?: string }) => void;
  stop: (opts?: { busytone?: string }) => void;
  setForceSpeakerphoneOn: (flag: boolean) => void;
  setSpeakerphoneOn: (enable: boolean) => void;
  setMicrophoneMute: (enable: boolean) => void;
  startProximitySensor?: () => void;
  stopProximitySensor?: () => void;
  startRingback?: (ringback: string) => void;
  stopRingback?: () => void;
};

let InCall: InCallManagerModule | null = null;
let inCallTried = false;
let ringbackPlayer: AudioPlayer | null = null;
let ringtonePlayer: AudioPlayer | null = null;

function getInCallManager(): InCallManagerModule | null {
  if (inCallTried) return InCall;
  inCallTried = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-incall-manager');
    const candidate = (mod?.default || mod) as InCallManagerModule | null;
    // Native module often missing in Expo Go / partial links — probe before use
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

async function applyExpoAudio(speakerOn: boolean) {
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
      // false → loudspeaker; true → earpiece (WhatsApp voice default)
      shouldRouteThroughEarpiece: !speakerOn,
    });
  } catch (err) {
    console.warn('[CallAudio] expo mode:', (err as Error).message);
  }
}

/**
 * Start the native call audio session (ringing → connected).
 * Voice → earpiece by default; video → speaker.
 */
export async function startCallAudio(opts: {
  callType: 'voice' | 'video';
  speakerOn: boolean;
}) {
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.start({
        media: opts.callType === 'video' ? 'video' : 'audio',
        auto: false,
      });
      mgr.setForceSpeakerphoneOn?.(opts.speakerOn);
      if (opts.callType === 'voice' && !opts.speakerOn) {
        mgr.startProximitySensor?.();
      }
    } catch (err) {
      markInCallBroken();
      console.warn('[CallAudio] InCall start:', (err as Error).message);
    }
  }
  await applyExpoAudio(opts.speakerOn);
}

/** Toggle loudspeaker ↔ earpiece mid-call (WhatsApp speaker button). */
export async function setCallSpeaker(speakerOn: boolean) {
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.setForceSpeakerphoneOn?.(speakerOn);
      mgr.setSpeakerphoneOn?.(speakerOn);
      if (speakerOn) mgr.stopProximitySensor?.();
      else mgr.startProximitySensor?.();
    } catch (err) {
      console.warn('[CallAudio] speaker:', (err as Error).message);
    }
  }
  await applyExpoAudio(speakerOn);
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

/** Tear down session when the call ends. */
export async function stopCallAudio() {
  stopCallRingback();
  stopIncomingRingtone();
  const mgr = getInCallManager();
  if (mgr) {
    try {
      mgr.stopProximitySensor?.();
      mgr.setForceSpeakerphoneOn?.(false);
      mgr.setSpeakerphoneOn?.(false);
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
}

/**
 * Outbound ringback — classic dual-tone (440+480 Hz) cadence like WhatsApp/PSTN.
 * Plays through earpiece unless speaker is on.
 */
export async function startCallRingback(speakerOn = false) {
  stopCallRingback();
  stopIncomingRingtone();

  // Keep call session in playAndRecord so ringback routes with the call
  await applyExpoAudio(speakerOn);

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

  // Incoming always on loudspeaker so you can hear it away from the phone
  await applyExpoAudio(true);

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

/** Re-assert routing after WebRTC connects (it often overwrites AVAudioSession). */
export async function reinforceCallAudio(speakerOn: boolean) {
  stopCallRingback();
  stopIncomingRingtone();
  await setCallSpeaker(speakerOn);
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
      mgr.setMicrophoneMute?.(false);
      mgr.stopProximitySensor?.();
      mgr.setForceSpeakerphoneOn?.(false);
      mgr.setSpeakerphoneOn?.(false);
      mgr.stop?.();
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
  await new Promise((r) => setTimeout(r, 80));
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
