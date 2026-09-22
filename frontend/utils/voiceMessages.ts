/**
 * Chat voice notes — upload, durable URL, and single-player coordination.
 * Uses expo-audio (Expo 57) — no extra packages.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import {
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
} from 'expo-audio';
import {
  fetchWithTimeout,
  getApiBase,
  UPLOAD_FETCH_TIMEOUT_MS,
} from './api';
import { getAuthToken } from './auth';
import { uploadsPathFromUrl } from './media';
import { requestMicrophone } from './appPermissions';

/** WhatsApp-like voice note: mono AAC in .m4a (works on Android APK + iOS). */
export const VOICE_NOTE_PRESET: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
  },
  ios: {
    extension: '.m4a',
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 48_000,
  },
};

/** System mic dialog — returns false if denied (never throws). */
export async function ensureVoiceMicPermission(): Promise<boolean> {
  try {
    return await requestMicrophone();
  } catch {
    return false;
  }
}

type VoicePlaybackHandle = {
  id: string;
  pause: () => void;
};

let activePlayback: VoicePlaybackHandle | null = null;

/** Pause any other voice note before this one plays. */
export function claimVoicePlayback(id: string, pause: () => void) {
  if (activePlayback && activePlayback.id !== id) {
    try {
      activePlayback.pause();
    } catch {
      /* ignore */
    }
  }
  activePlayback = { id, pause };
}

export function releaseVoicePlayback(id: string) {
  if (activePlayback?.id === id) activePlayback = null;
}

export function pauseActiveVoicePlayback() {
  if (!activePlayback) return;
  try {
    activePlayback.pause();
  } catch {
    /* ignore */
  }
  activePlayback = null;
}

function mimeForUri(uri: string): string {
  const ext = uri.split('.').pop()?.toLowerCase()?.split('?')[0] || 'm4a';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === '3gp') return 'audio/3gpp';
  if (ext === 'caf') return 'audio/x-caf';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'webm') return 'audio/webm';
  return 'audio/mp4';
}

function preferRelativeUploadUrl(json: {
  url?: string;
  absoluteUrl?: string;
}): string | null {
  const relative = String(json?.url || '').trim();
  if (relative.startsWith('/uploads/')) return relative;
  const abs = String(json?.absoluteUrl || '').trim();
  if (!abs) return relative || null;
  const path = uploadsPathFromUrl(abs);
  return path || abs;
}

/**
 * Upload a local voice file. Prefers binary (like images); falls back to base64 JSON.
 * Returns durable `/uploads/...` path for chat:message.
 */
export async function uploadVoiceNote(uri: string): Promise<string | null> {
  const token = await getAuthToken();
  if (!token || !uri) return null;

  const mime = mimeForUri(uri);
  const originalName = `voice_${Date.now()}.m4a`;

  // 1) Binary upload (fast, reliable on slow networks / longer notes)
  try {
    const url = `${getApiBase()}/api/upload/audio-bin`;
    if (Platform.OS !== 'web' && FileSystem.uploadAsync) {
      const result = await FileSystem.uploadAsync(url, uri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': mime,
          'X-Original-Name': originalName,
        },
      });
      if (result.status >= 200 && result.status < 300) {
        try {
          const json = JSON.parse(result.body || '{}');
          const path = preferRelativeUploadUrl(json);
          if (path) return path;
        } catch {
          console.error('Audio upload returned non-JSON body');
        }
      } else {
        console.error('Audio binary upload failed', result.status, result.body);
      }
    } else {
      const buf = await fetch(uri).then((r) => r.arrayBuffer());
      const res = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': mime,
            'X-Original-Name': originalName,
          },
          body: buf,
        },
        UPLOAD_FETCH_TIMEOUT_MS,
      );
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const path = preferRelativeUploadUrl(json);
        if (path) return path;
      }
    }
  } catch (e) {
    console.warn('Audio binary upload failed, trying base64', e);
  }

  // 2) Legacy base64 JSON (same endpoint as before)
  try {
    const encoding =
      (FileSystem as any).EncodingType?.Base64 ||
      (FileSystem as any).EncodingType?.base64 ||
      'base64';
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding,
    } as any);
    if (!base64) {
      console.error('Audio upload failed: empty base64');
      return null;
    }
    const dataUri = `data:${mime};base64,${base64}`;
    const res = await fetchWithTimeout(
      `${getApiBase()}/api/upload/audio`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ base64: dataUri, originalName }),
      },
      UPLOAD_FETCH_TIMEOUT_MS,
    );
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('Audio upload failed', json?.error || res.status);
      return null;
    }
    return preferRelativeUploadUrl(json);
  } catch (e) {
    console.error('Audio upload failed', e);
    return null;
  }
}
