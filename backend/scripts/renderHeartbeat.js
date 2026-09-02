#!/usr/bin/env node
/**
 * External keep-alive ping for Render Cron Job (every 60s).
 * Keeps Web Service warm and verifies it responds — does NOT run inside the API process.
 *
 * Env:
 *   HEARTBEAT_TARGET_URL  — full base URL, e.g. https://luvstor-api.onrender.com
 *   HEARTBEAT_TARGET_HOST — hostname only (from Render blueprint)
 *   HEARTBEAT_SECRET      — must match API service
 *   HEARTBEAT_TIMEOUT_MS  — default 10000
 *   HEARTBEAT_MAX_RETRIES — default 2
 */
const http = require('http');
const https = require('https');

const timeoutMs = Number(process.env.HEARTBEAT_TIMEOUT_MS || 10_000);
const maxRetries = Number(process.env.HEARTBEAT_MAX_RETRIES || 2);
const secret = String(process.env.HEARTBEAT_SECRET || '').trim();

function resolvePingUrl() {
  const explicit = String(process.env.HEARTBEAT_TARGET_URL || '').trim();
  if (explicit) {
    return `${explicit.replace(/\/$/, '')}/ping`;
  }

  const host = String(
    process.env.HEARTBEAT_TARGET_HOST ||
      process.env.RENDER_EXTERNAL_URL?.replace(/^https?:\/\//, '') ||
      '',
  ).trim();

  if (!host) {
    throw new Error(
      'Set HEARTBEAT_TARGET_URL or HEARTBEAT_TARGET_HOST (Render cron → web service host)',
    );
  }

  const cleanHost = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${cleanHost}/ping`;
}

function pingOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const started = Date.now();

    const req = lib.get(
      url,
      {
        headers: secret ? { 'X-Heartbeat-Secret': secret } : {},
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        const ms = Date.now() - started;
        if (res.statusCode === 200) {
          resolve({ status: res.statusCode, ms });
        } else {
          reject(new Error(`HTTP ${res.statusCode} (${ms}ms)`));
        }
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

async function main() {
  const url = resolvePingUrl();
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      const wait = attempt * 2000;
      console.log(`[Heartbeat] retry ${attempt}/${maxRetries} in ${wait}ms…`);
      await new Promise((r) => setTimeout(r, wait));
    }

    try {
      const result = await pingOnce(url);
      console.log(`[Heartbeat] OK ${url} (${result.ms}ms)`);
      process.exit(0);
    } catch (err) {
      lastErr = err;
      console.warn(`[Heartbeat] attempt ${attempt + 1} failed: ${err.message}`);
    }
  }

  console.error(`[Heartbeat] FAILED ${url}: ${lastErr?.message || 'unknown'}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[Heartbeat] fatal:', err.message);
  process.exit(1);
});
