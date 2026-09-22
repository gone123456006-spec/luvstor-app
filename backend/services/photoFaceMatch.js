/**
 * Dating-app photo verification: live pose + match selfie to profile photos.
 *
 * FACE_MATCH_PROVIDER=
 *   dating      (default) — pose + profile checks, auto-approve when strong
 *   rekognition — AWS CompareFaces when credentials are configured
 */
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const {
  PHOTO_VERIFICATION_TOKENS,
} = require('./chatTokens');

const POSES = [
  {
    id: 'smile',
    label: 'Smile',
    instruction: 'Look at the camera and smile naturally.',
  },
  {
    id: 'turn_left',
    label: 'Turn left',
    instruction: 'Turn your head slightly to your left, then hold.',
  },
  {
    id: 'turn_right',
    label: 'Turn right',
    instruction: 'Turn your head slightly to your right, then hold.',
  },
];

const MATCH_APPROVE_SCORE = 80;
/** How long analysis runs before approve/reject. */
const REVIEW_DELAY_MS = 30 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const PROVIDER = String(process.env.FACE_MATCH_PROVIDER || 'dating')
  .trim()
  .toLowerCase();

function challengeSecret() {
  return (
    process.env.PHOTO_VERIFY_SECRET ||
    process.env.JWT_SECRET ||
    'luvstor-photo-verify'
  );
}

function pickPose() {
  return POSES[Math.floor(Math.random() * POSES.length)];
}

function createChallenge() {
  const pose = pickPose();
  const exp = Date.now() + CHALLENGE_TTL_MS;
  const payload = `${pose.id}.${exp}`;
  const sig = crypto
    .createHmac('sha256', challengeSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  return {
    pose: pose.id,
    label: pose.label,
    instruction: pose.instruction,
    challengeToken: `${payload}.${sig}`,
    expiresAt: new Date(exp).toISOString(),
    expiresInMs: CHALLENGE_TTL_MS,
  };
}

function verifyChallengeToken(token, expectedPose) {
  const raw = String(token || '');
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'Invalid challenge' };
  const [pose, expStr, sig] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) {
    return { ok: false, reason: 'Challenge expired — get a new pose' };
  }
  if (expectedPose && pose !== expectedPose) {
    return { ok: false, reason: 'Pose does not match challenge' };
  }
  const payload = `${pose}.${expStr}`;
  const expect = crypto
    .createHmac('sha256', challengeSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 32);
  if (sig !== expect) return { ok: false, reason: 'Invalid challenge' };
  return { ok: true, pose };
}

function profilePhotoUrls(user) {
  const list = [];
  const main = String(user.photo || '').trim();
  if (main) list.push(main);
  const extras = Array.isArray(user.photos) ? user.photos : [];
  for (const p of extras) {
    const u = String(p || '').trim();
    if (u && !list.includes(u)) list.push(u);
  }
  return list.slice(0, 3);
}

function resolveLocalUploadPath(urlPath) {
  const { getUploadsDir } = require('../utils/uploadsPath');
  const root = getUploadsDir();
  const rel = String(urlPath || '').replace(/^\/uploads\//, '');
  if (!rel || rel.includes('..')) return null;
  const abs = path.join(root, rel);
  if (!abs.startsWith(root)) return null;
  return abs;
}

async function loadImageBuffer(url, apiBase) {
  const raw = String(url || '').trim();
  if (!raw) return null;

  if (raw.startsWith('/api/media/')) {
    try {
      const { loadMediaById, mediaIdFromUrl } = require('./mediaStore');
      const id = mediaIdFromUrl(raw);
      const doc = id ? await loadMediaById(id) : null;
      if (doc?.data?.length >= 2048) return doc.data;
    } catch {
      /* fall through to HTTP */
    }
  }

  if (raw.startsWith('/uploads/')) {
    const abs = resolveLocalUploadPath(raw);
    if (abs && fs.existsSync(abs)) {
      try {
        const buf = await fs.promises.readFile(abs);
        return buf.length >= 2048 ? buf : null;
      } catch {
        return null;
      }
    }
  }

  let fetchUrl = raw;
  if (raw.startsWith('/')) {
    const base = String(apiBase || process.env.PUBLIC_API_URL || '').replace(
      /\/$/,
      '',
    );
    if (!base) return null;
    fetchUrl = `${base}${raw}`;
  }

  try {
    const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length >= 2048 ? buf : null;
  } catch {
    return null;
  }
}

async function compareWithRekognition(selfieBuf, profileBufs) {
  let RekognitionClient;
  let CompareFacesCommand;
  try {
    ({ RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition'));
  } catch {
    return null;
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region || !process.env.AWS_ACCESS_KEY_ID) return null;

  const client = new RekognitionClient({ region });
  let best = 0;
  for (const target of profileBufs) {
    try {
      const out = await client.send(
        new CompareFacesCommand({
          SourceImage: { Bytes: selfieBuf },
          TargetImage: { Bytes: target },
          SimilarityThreshold: 50,
        }),
      );
      for (const m of out.FaceMatches || []) {
        best = Math.max(best, Number(m.Similarity) || 0);
      }
    } catch (e) {
      console.warn('[photoFaceMatch] rekognition compare failed', e?.message || e);
    }
  }
  return best;
}

/**
 * Dating-mode score (no AWS): pose + real profile photos + live selfie checks.
 * Strong enough for launch; enable rekognition for production-grade match.
 */
function datingModeScore({ poseOk, profileCount, selfieBuf, profileBufs, selfieUrl, profileUrls }) {
  let score = 0;
  const notes = [];

  if (poseOk) {
    score += 30;
  } else {
    notes.push('Complete the live pose challenge');
  }

  if (profileCount >= 1) {
    score += 25;
  } else {
    notes.push('Add a clear profile photo first');
  }

  if (selfieBuf && selfieBuf.length >= 8_000) {
    score += 20;
  } else {
    notes.push('Take a clearer selfie');
  }

  const sameAsProfile = profileUrls.some((u) => u === selfieUrl);
  if (sameAsProfile) {
    notes.push('Use a new live selfie, not your profile photo');
  } else {
    score += 15;
  }

  // Exact byte match → reused file / screenshot of own gallery photo
  let duplicate = false;
  if (selfieBuf && profileBufs.length) {
    for (const p of profileBufs) {
      if (p.length === selfieBuf.length && p.equals(selfieBuf)) {
        duplicate = true;
        break;
      }
    }
  }
  if (duplicate) {
    notes.push('Selfie must be a fresh camera capture');
  } else if (selfieBuf) {
    score += 10;
  }

  return { score, notes };
}

/**
 * Analyze live selfie vs DP + up to 3 profile photos.
 * @param {{ skipChallenge?: boolean }} opts — set when challenge was already
 *   validated at submit time (final review after 30 minutes).
 * @returns {{ decision: 'approve'|'reject', score: number, reason: string, provider: string }}
 */
async function evaluatePhotoMatch({
  user,
  selfieUrl,
  pose,
  challengeToken,
  apiBase,
  skipChallenge = false,
}) {
  if (!skipChallenge) {
    const challenge = verifyChallengeToken(challengeToken, pose);
    if (!challenge.ok) {
      return {
        decision: 'reject',
        score: 0,
        reason: challenge.reason,
        provider: PROVIDER,
      };
    }
  }

  const profiles = profilePhotoUrls(user);
  if (!profiles.length) {
    return {
      decision: 'reject',
      score: 0,
      reason: 'Add at least one clear profile photo, then try again.',
      provider: PROVIDER,
    };
  }

  const selfieBuf = await loadImageBuffer(selfieUrl, apiBase);
  const profileBufs = [];
  for (const u of profiles) {
    const b = await loadImageBuffer(u, apiBase);
    if (b) profileBufs.push(b);
  }

  if (PROVIDER === 'rekognition') {
    if (!selfieBuf || !profileBufs.length) {
      return {
        decision: 'reject',
        score: 0,
        reason: 'Could not read photos for face match. Try again.',
        provider: 'rekognition',
      };
    }
    const similarity = await compareWithRekognition(selfieBuf, profileBufs);
    if (similarity == null) {
      console.warn('[photoFaceMatch] rekognition unavailable — using dating mode');
    } else {
      const score = Math.round(similarity);
      if (score >= MATCH_APPROVE_SCORE) {
        return {
          decision: 'approve',
          score,
          reason: 'Face matches your profile photos.',
          provider: 'rekognition',
        };
      }
      return {
        decision: 'reject',
        score,
        reason:
          score >= 60
            ? 'Soft match — try again with better lighting and face the camera.'
            : 'Selfie does not match your profile photos. Update photos or try again.',
        provider: 'rekognition',
      };
    }
  }

  const { score, notes } = datingModeScore({
    poseOk: true,
    profileCount: profiles.length,
    selfieBuf,
    profileBufs,
    selfieUrl,
    profileUrls: profiles,
  });

  if (score >= MATCH_APPROVE_SCORE) {
    return {
      decision: 'approve',
      score,
      reason: 'Live selfie verified against your profile photos.',
      provider: 'dating',
    };
  }

  return {
    decision: 'reject',
    score,
    reason: notes[0] || 'Could not verify — please try again.',
    provider: 'dating',
  };
}

function mainPhotoFingerprint(user) {
  return String(user.photo || (user.photos && user.photos[0]) || '').trim();
}

module.exports = {
  POSES,
  MATCH_APPROVE_SCORE,
  REVIEW_DELAY_MS,
  PHOTO_VERIFICATION_TOKENS,
  createChallenge,
  verifyChallengeToken,
  profilePhotoUrls,
  evaluatePhotoMatch,
  mainPhotoFingerprint,
  CHALLENGE_TTL_MS,
};
