/**
 * Expo config plugin: Android foreground service for active voice/video calls.
 *
 * Play-compliant types ONLY (no Telecom ConnectionService → no phoneCall):
 *   - microphone  — user-initiated voice/video call mic capture
 *   - camera      — user-initiated video call camera capture (when camera on)
 *
 * FGS starts only while an active call has media, after runtime mic/camera
 * grants, while the app is user-visible. Stops immediately on hangup.
 * Force-stop by the OS still ends the process — we do not claim otherwise.
 */
const {
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
  AndroidConfig,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/** Only FGS-type permissions we actually use. POST_NOTIFICATIONS is separate. */
const FGS_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.FOREGROUND_SERVICE_CAMERA',
];

const SERVICE_KT = `package com.luvstor.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class CallForegroundService : Service() {
  companion object {
    const val CHANNEL_ID = "ongoing_calls"
    const val NOTIF_ID = 77021
    const val ACTION_START = "com.luvstor.app.CALL_FGS_START"
    const val ACTION_STOP = "com.luvstor.app.CALL_FGS_STOP"
    const val ACTION_UPDATE = "com.luvstor.app.CALL_FGS_UPDATE"
    const val ACTION_END = "com.luvstor.app.CALL_FGS_END"
    const val EXTRA_CALL_ID = "callId"
    const val EXTRA_PEER_NAME = "peerName"
    const val EXTRA_CALL_TYPE = "callType"
    const val EXTRA_DURATION = "durationSec"
    const val EXTRA_HAS_CAMERA = "hasCamera"
    const val EXTRA_STATUS = "status"

    @JvmStatic
    var isRunning: Boolean = false
      private set
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      ACTION_UPDATE -> {
        val callId = intent.getStringExtra(EXTRA_CALL_ID) ?: ""
        val peer = intent.getStringExtra(EXTRA_PEER_NAME) ?: "Call"
        val type = intent.getStringExtra(EXTRA_CALL_TYPE) ?: "voice"
        val duration = intent.getIntExtra(EXTRA_DURATION, 0)
        val hasCamera = intent.getBooleanExtra(EXTRA_HAS_CAMERA, false)
        val status = intent.getStringExtra(EXTRA_STATUS) ?: "connected"
        // Re-apply startForeground so Android 14+ FGS type matches cam on/off
        val notification = buildNotification(callId, peer, type, duration, hasCamera, status)
        startForegroundTyped(notification, hasCamera, type)
        isRunning = true
        return START_STICKY
      }
      else -> {
        val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: ""
        val peer = intent?.getStringExtra(EXTRA_PEER_NAME) ?: "Call"
        val type = intent?.getStringExtra(EXTRA_CALL_TYPE) ?: "voice"
        val duration = intent?.getIntExtra(EXTRA_DURATION, 0) ?: 0
        val hasCamera = intent?.getBooleanExtra(EXTRA_HAS_CAMERA, false) ?: false
        val status = intent?.getStringExtra(EXTRA_STATUS) ?: "connected"
        ensureChannel()
        val notification = buildNotification(callId, peer, type, duration, hasCamera, status)
        startForegroundTyped(notification, hasCamera, type)
        isRunning = true
        return START_STICKY
      }
    }
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun stopForegroundCompat() {
    isRunning = false
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  private fun startForegroundTyped(notification: Notification, hasCamera: Boolean, callType: String) {
    // Play policy: declare only types in genuine use for this session.
    // - voice / video-cam-off → microphone
    // - video with camera on  → microphone|camera
    // Do NOT use phoneCall (requires MANAGE_OWN_CALLS / dialer role).
    // Do NOT use mediaPlayback (this service is for live call capture, not media players).
    if (Build.VERSION.SDK_INT >= 34) {
      var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      if (hasCamera && callType == "video") {
        types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      }
      startForeground(NOTIF_ID, notification, types)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (nm.getNotificationChannel(CHANNEL_ID) != null) return
    val ch = NotificationChannel(
      CHANNEL_ID,
      "Ongoing calls",
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      description = "Shows while a Luvstor voice or video call is active"
      setShowBadge(false)
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    nm.createNotificationChannel(ch)
  }

  private fun formatDuration(sec: Int): String {
    val s = sec.coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
  }

  private fun buildNotification(
    callId: String,
    peerName: String,
    callType: String,
    durationSec: Int,
    hasCamera: Boolean,
    status: String = "connected",
  ): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK
      putExtra("luvstor_open_call", true)
      putExtra("callId", callId)
      putExtra("callType", callType)
    }
    val contentPi = PendingIntent.getActivity(
      this,
      1001,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val endIntent = Intent(this, CallForegroundEndReceiver::class.java).apply {
      action = ACTION_END
      putExtra(EXTRA_CALL_ID, callId)
    }
    val endPi = PendingIntent.getBroadcast(
      this,
      1002,
      endIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val typeLabel = if (callType == "video") "Video call" else "Voice call"
    val text = when {
      status == "calling" -> "$typeLabel · Calling…"
      status == "ringing" -> "$typeLabel · Ringing…"
      durationSec > 0 -> "$typeLabel · " + formatDuration(durationSec)
      else -> "$typeLabel · Ongoing"
    }

    val iconRes = resources.getIdentifier("notification_icon", "drawable", packageName)
    val smallIcon = if (iconRes != 0) iconRes else android.R.drawable.stat_sys_phone_call

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(peerName.ifBlank { "Luvstor call" })
      .setContentText(text)
      .setSmallIcon(smallIcon)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(contentPi)
      .addAction(0, "End call", endPi)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }
}
`;

const RECEIVER_KT = `package com.luvstor.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Notification "End call" action — stops FGS and notifies JS when the bridge is alive. */
class CallForegroundEndReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    try {
      CallForegroundModule.emitEndCallRequested(
        intent?.getStringExtra(CallForegroundService.EXTRA_CALL_ID)
      )
    } catch (_: Throwable) {
    }
    try {
      val stop = Intent(context, CallForegroundService::class.java).apply {
        action = CallForegroundService.ACTION_STOP
      }
      context.startService(stop)
      context.stopService(Intent(context, CallForegroundService::class.java))
    } catch (_: Throwable) {
    }
  }
}
`;

const MODULE_KT = `package com.luvstor.app

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.Intent
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class CallForegroundModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  companion object {
    private var instance: CallForegroundModule? = null
    private const val EVENT_END = "luvstor_call_end_requested"

    @JvmStatic
    fun emitEndCallRequested(callId: String?) {
      val mod = instance ?: return
      if (!mod.ctx.hasActiveReactInstance()) return
      val map = WritableNativeMap()
      map.putString("callId", callId ?: "")
      mod.ctx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT_END, map)
    }
  }

  override fun getName(): String = "LuvstorCallForeground"

  override fun initialize() {
    super.initialize()
    instance = this
  }

  override fun invalidate() {
    if (instance === this) instance = null
    super.invalidate()
  }

  @ReactMethod
  fun start(callId: String, peerName: String, callType: String, hasCamera: Boolean, status: String, promise: Promise) {
    try {
      val intent = Intent(ctx, CallForegroundService::class.java).apply {
        action = CallForegroundService.ACTION_START
        putExtra(CallForegroundService.EXTRA_CALL_ID, callId)
        putExtra(CallForegroundService.EXTRA_PEER_NAME, peerName)
        putExtra(CallForegroundService.EXTRA_CALL_TYPE, callType)
        putExtra(CallForegroundService.EXTRA_HAS_CAMERA, hasCamera)
        putExtra(CallForegroundService.EXTRA_STATUS, status.ifBlank { "connected" })
        putExtra(CallForegroundService.EXTRA_DURATION, 0)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("FGS_START", e.message, e)
    }
  }

  @ReactMethod
  fun update(callId: String, peerName: String, callType: String, durationSec: Int, hasCamera: Boolean, status: String, promise: Promise) {
    try {
      val intent = Intent(ctx, CallForegroundService::class.java).apply {
        action = CallForegroundService.ACTION_UPDATE
        putExtra(CallForegroundService.EXTRA_CALL_ID, callId)
        putExtra(CallForegroundService.EXTRA_PEER_NAME, peerName)
        putExtra(CallForegroundService.EXTRA_CALL_TYPE, callType)
        putExtra(CallForegroundService.EXTRA_DURATION, durationSec)
        putExtra(CallForegroundService.EXTRA_HAS_CAMERA, hasCamera)
        putExtra(CallForegroundService.EXTRA_STATUS, status.ifBlank { "connected" })
      }
      ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("FGS_UPDATE", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      val intent = Intent(ctx, CallForegroundService::class.java).apply {
        action = CallForegroundService.ACTION_STOP
      }
      ctx.startService(intent)
      ctx.stopService(Intent(ctx, CallForegroundService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("FGS_STOP", e.message, e)
    }
  }

  @ReactMethod
  fun isAvailable(promise: Promise) {
    promise.resolve(true)
  }

  @ReactMethod
  fun enterPictureInPicture(promise: Promise) {
    try {
      val activity: Activity? = currentActivity
      if (activity == null) {
        promise.resolve(false)
        return
      }
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(false)
        return
      }
      if (!activity.packageManager.hasSystemFeature(android.content.pm.PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
        promise.resolve(false)
        return
      }
      val params = PictureInPictureParams.Builder()
        .setAspectRatio(Rational(9, 16))
        .build()
      val ok = activity.enterPictureInPictureMode(params)
      promise.resolve(ok)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // Required for RN built-in EventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // Required for RN built-in EventEmitter
  }
}
`;

const PACKAGE_KT = `package com.luvstor.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class CallForegroundPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(CallForegroundModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function withCallForegroundService(config) {
  // Permissions
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    for (const permission of FGS_PERMISSIONS) {
      AndroidConfig.Permissions.ensurePermission(manifest, permission);
    }

    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    if (!app.service) app.service = [];
    const services = app.service;
    const svcName = 'com.luvstor.app.CallForegroundService';
    const existing = services.find((s) => s?.$?.['android:name'] === svcName);
    const svcEntry = {
      $: {
        'android:name': svcName,
        'android:exported': 'false',
        // Max set this service may use; runtime startForeground() passes a subset.
        'android:foregroundServiceType': 'microphone|camera',
        // Keep service with the call notification if the task is swiped;
        // End Call action / hangup still stop it. Force-stop still kills everything.
        'android:stopWithTask': 'false',
      },
    };
    if (existing) Object.assign(existing, svcEntry);
    else services.push(svcEntry);

    if (!app.receiver) app.receiver = [];
    const receivers = app.receiver;
    const recvName = 'com.luvstor.app.CallForegroundEndReceiver';
    if (!receivers.find((r) => r?.$?.['android:name'] === recvName)) {
      receivers.push({
        $: {
          'android:name': recvName,
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [
              { $: { 'android:name': 'com.luvstor.app.CALL_FGS_END' } },
            ],
          },
        ],
      });
    }

    // System PiP for video calls (MainActivity)
    const activities = app.activity || [];
    for (const act of activities) {
      const name = act?.$?.['android:name'] || '';
      if (name.includes('MainActivity')) {
        act.$['android:supportsPictureInPicture'] = 'true';
        const prev = act.$['android:configChanges'] || '';
        const needed = [
          'keyboard',
          'keyboardHidden',
          'orientation',
          'screenSize',
          'screenLayout',
          'smallestScreenSize',
          'uiMode',
        ];
        const set = new Set(
          prev
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean),
        );
        needed.forEach((n) => set.add(n));
        act.$['android:configChanges'] = [...set].join('|');
        act.$['android:resizeableActivity'] = 'true';
      }
    }

    return cfg;
  });

  // Write Kotlin sources
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const root = cfg.modRequest.platformProjectRoot;
      const pkgDir = path.join(
        root,
        'app',
        'src',
        'main',
        'java',
        'com',
        'luvstor',
        'app',
      );
      ensureDir(pkgDir);
      fs.writeFileSync(
        path.join(pkgDir, 'CallForegroundService.kt'),
        SERVICE_KT,
      );
      fs.writeFileSync(
        path.join(pkgDir, 'CallForegroundEndReceiver.kt'),
        RECEIVER_KT,
      );
      fs.writeFileSync(
        path.join(pkgDir, 'CallForegroundModule.kt'),
        MODULE_KT,
      );
      fs.writeFileSync(
        path.join(pkgDir, 'CallForegroundPackage.kt'),
        PACKAGE_KT,
      );
      return cfg;
    },
  ]);

  // Register ReactPackage in MainApplication
  config = withMainApplication(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes('CallForegroundPackage')) {
      if (src.includes('ApplicationLifecycleDispatcher')) {
        // Kotlin MainApplication (Expo)
        if (!src.includes('import com.luvstor.app.CallForegroundPackage')) {
          src = src.replace(
            /(package\s+[^\n]+\n)/,
            '$1\nimport com.luvstor.app.CallForegroundPackage\n',
          );
        }
        if (src.includes('PackageList(this).packages.apply')) {
          src = src.replace(
            /PackageList\(this\)\.packages\.apply\s*\{/,
            `PackageList(this).packages.apply {\n              add(CallForegroundPackage())`,
          );
        } else if (src.includes('packages.apply {')) {
          src = src.replace(
            /packages\.apply\s*\{/,
            `packages.apply {\n              add(CallForegroundPackage())`,
          );
        }
      }
    }
    cfg.modResults.contents = src;
    return cfg;
  });

  return config;
}

module.exports = withCallForegroundService;
