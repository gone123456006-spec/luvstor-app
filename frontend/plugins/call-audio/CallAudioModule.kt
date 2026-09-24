package com.luvstor.app

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Single Android owner for in-call audio.
 *
 * Uses AudioManager communication routing (API 31+ setCommunicationDevice,
 * older Bluetooth SCO) so speaker / mute never disconnect the headset.
 */
class CallAudioModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  companion object {
    private const val EVENT = "luvstor_call_audio"
    private const val ROUTE_BT = "bluetooth"
    private const val ROUTE_WIRED = "wired"
    private const val ROUTE_EAR = "earpiece"
    private const val ROUTE_SPK = "speaker"
  }

  private val main = Handler(Looper.getMainLooper())
  private val audio: AudioManager =
    ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  private var active = false
  private var callType = "voice"
  private var speakerForced = false
  private var muted = false
  private var selected = ROUTE_EAR
  private var scoWanted = false
  private var focusRequest: AudioFocusRequest? = null
  private var deviceCallback: AudioDeviceCallback? = null
  private var scoReceiver: BroadcastReceiver? = null
  private var wiredReceiver: BroadcastReceiver? = null

  override fun getName(): String = "LuvstorCallAudio"

  @ReactMethod
  fun start(callType: String, preferSpeaker: Boolean, promise: Promise) {
    runOnMain {
      try {
        val first = !active
        this.callType = if (callType == "video") "video" else "voice"
        active = true
        if (first) {
          muted = false
          speakerForced = false
          requestFocus()
          audio.mode = AudioManager.MODE_IN_COMMUNICATION
          // Never mute as part of start — mute is independent.
          audio.isMicrophoneMute = false
          bindDeviceListeners()
          if (preferSpeaker && !hasBluetooth() && !hasWired()) {
            speakerForced = true
          }
          applyBestRoute(userPickedSpeaker = speakerForced)
        } else {
          // Already in a call — reassert only. Do not reset speaker / mute / BT.
          reassertInternal()
        }
        promise.resolve(snapshotMap())
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_START", e.message, e)
      }
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    runOnMain {
      try {
        teardown(keepBluetoothPaired = true)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_STOP", e.message, e)
      }
    }
  }

  @ReactMethod
  fun setSpeaker(on: Boolean, promise: Promise) {
    runOnMain {
      if (!active) {
        promise.resolve(snapshotMap())
        return@runOnMain
      }
      try {
        speakerForced = on
        applyBestRoute(userPickedSpeaker = on)
        promise.resolve(snapshotMap())
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_SPEAKER", e.message, e)
      }
    }
  }

  @ReactMethod
  fun setRoute(route: String, promise: Promise) {
    runOnMain {
      if (!active) {
        promise.resolve(snapshotMap())
        return@runOnMain
      }
      try {
        speakerForced = route == ROUTE_SPK
        when (route) {
          ROUTE_SPK -> routeToSpeaker()
          ROUTE_BT -> routeToBluetooth()
          ROUTE_WIRED -> routeToWired()
          else -> routeToEarpiece()
        }
        emit()
        promise.resolve(snapshotMap())
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_ROUTE", e.message, e)
      }
    }
  }

  @ReactMethod
  fun setMuted(nextMuted: Boolean, promise: Promise) {
    runOnMain {
      try {
        muted = nextMuted
        // Hardware mute only — never touch SCO / communication device.
        audio.isMicrophoneMute = nextMuted
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_MUTE", e.message, e)
      }
    }
  }

  @ReactMethod
  fun reassert(promise: Promise) {
    runOnMain {
      try {
        if (active) reassertInternal()
        promise.resolve(snapshotMap())
      } catch (e: Exception) {
        promise.reject("CALL_AUDIO_REASSERT", e.message, e)
      }
    }
  }

  @ReactMethod
  fun getSnapshot(promise: Promise) {
    runOnMain {
      promise.resolve(snapshotMap())
    }
  }

  @ReactMethod
  fun addListener(eventName: String) {
    // RN EventEmitter
  }

  @ReactMethod
  fun removeListeners(count: Int) {
    // RN EventEmitter
  }

  private fun reassertInternal() {
    requestFocus()
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    audio.isMicrophoneMute = muted
    applyCurrentRoute()
  }

  private fun applyBestRoute(userPickedSpeaker: Boolean) {
    if (userPickedSpeaker) {
      routeToSpeaker()
      emit()
      return
    }
    when {
      hasBluetooth() -> routeToBluetooth()
      hasWired() -> routeToWired()
      callType == "video" -> routeToSpeaker()
      else -> routeToEarpiece()
    }
    emit()
  }

  private fun applyCurrentRoute() {
    when (selected) {
      ROUTE_SPK -> routeToSpeaker()
      ROUTE_BT -> if (hasBluetooth()) routeToBluetooth() else applyBestRoute(false)
      ROUTE_WIRED -> if (hasWired()) routeToWired() else applyBestRoute(false)
      else -> routeToEarpiece()
    }
    emit()
  }

  private fun onDevicesChanged() {
    if (!active) return
    val available = availableRoutes()
    val currentGone = !available.contains(selected)
    val btNow = available.contains(ROUTE_BT)

    if (btNow && selected != ROUTE_BT && !speakerForced) {
      // Headset appeared mid-call — switch without restarting the call.
      routeToBluetooth()
      emit()
      return
    }
    if (currentGone) {
      speakerForced = speakerForced && available.contains(ROUTE_SPK)
      applyBestRoute(speakerForced)
      return
    }
    emit()
  }

  private fun routeToBluetooth() {
    selected = ROUTE_BT
    speakerForced = false
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    audio.isMicrophoneMute = muted
    if (Build.VERSION.SDK_INT >= 31) {
      val device = findCommDevice(::isBluetoothDevice)
      if (device != null) {
        audio.setCommunicationDevice(device)
        scoWanted = false
        return
      }
    }
    // API 23–30: SCO for headset speakers + mic. Do not disable the adapter.
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = false
    scoWanted = true
    startScoIfNeeded()
  }

  private fun routeToSpeaker() {
    selected = ROUTE_SPK
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    audio.isMicrophoneMute = muted
    if (Build.VERSION.SDK_INT >= 31) {
      val device = findCommDevice { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
      if (device != null) {
        audio.setCommunicationDevice(device)
      }
      // Leave Bluetooth paired. Do not stop SCO / disconnect the profile.
      scoWanted = false
      return
    }
    scoWanted = false
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = true
  }

  private fun routeToWired() {
    selected = ROUTE_WIRED
    speakerForced = false
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    audio.isMicrophoneMute = muted
    if (Build.VERSION.SDK_INT >= 31) {
      val device = findCommDevice(::isWiredDevice)
      if (device != null) {
        audio.setCommunicationDevice(device)
        scoWanted = false
        return
      }
    }
    scoWanted = false
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = false
  }

  private fun routeToEarpiece() {
    selected = ROUTE_EAR
    speakerForced = false
    audio.mode = AudioManager.MODE_IN_COMMUNICATION
    audio.isMicrophoneMute = muted
    if (Build.VERSION.SDK_INT >= 31) {
      val device = findCommDevice { it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE }
      if (device != null) {
        audio.setCommunicationDevice(device)
      } else {
        audio.clearCommunicationDevice()
      }
      scoWanted = false
      return
    }
    scoWanted = false
    @Suppress("DEPRECATION")
    audio.isSpeakerphoneOn = false
  }

  private fun startScoIfNeeded() {
    if (Build.VERSION.SDK_INT >= 31) return
    try {
      if (!audio.isBluetoothScoOn) {
        audio.startBluetoothSco()
      }
      @Suppress("DEPRECATION")
      audio.isBluetoothScoOn = true
    } catch (_: Throwable) {
      /* headset may still play via A2DP until SCO is ready */
    }
  }

  private fun teardown(keepBluetoothPaired: Boolean) {
    unbindDeviceListeners()
    active = false
    speakerForced = false
    scoWanted = false
    try {
      audio.isMicrophoneMute = false
    } catch (_: Throwable) {
    }
    try {
      if (Build.VERSION.SDK_INT >= 31) {
        audio.clearCommunicationDevice()
      } else {
        @Suppress("DEPRECATION")
        audio.isSpeakerphoneOn = false
        // Release SCO audio only — never disable / disconnect the adapter.
        if (audio.isBluetoothScoOn) {
          try {
            audio.stopBluetoothSco()
          } catch (_: Throwable) {
          }
          @Suppress("DEPRECATION")
          audio.isBluetoothScoOn = false
        }
      }
    } catch (_: Throwable) {
    }
    try {
      audio.mode = AudioManager.MODE_NORMAL
    } catch (_: Throwable) {
    }
    abandonFocus()
    muted = false
    selected = ROUTE_EAR
    if (!keepBluetoothPaired) {
      /* reserved — we never unpair */
    }
    emit()
  }

  private fun availableRoutes(): List<String> {
    val out = linkedSetOf<String>()
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        for (device in audio.availableCommunicationDevices) {
          when {
            isBluetoothDevice(device) -> out.add(ROUTE_BT)
            isWiredDevice(device) -> out.add(ROUTE_WIRED)
            device.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> out.add(ROUTE_EAR)
            device.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> out.add(ROUTE_SPK)
          }
        }
      } catch (_: SecurityException) {
        /* BLUETOOTH_CONNECT missing — still list built-in routes */
      }
    } else {
      if (hasBluetooth()) out.add(ROUTE_BT)
      if (hasWired()) out.add(ROUTE_WIRED)
      out.add(ROUTE_EAR)
      out.add(ROUTE_SPK)
    }
    if (!out.contains(ROUTE_SPK)) out.add(ROUTE_SPK)
    if (!out.contains(ROUTE_WIRED) && !out.contains(ROUTE_EAR)) out.add(ROUTE_EAR)
    return out.toList()
  }

  private fun hasBluetooth(): Boolean {
    if (Build.VERSION.SDK_INT >= 31) {
      return try {
        audio.availableCommunicationDevices.any(::isBluetoothDevice)
      } catch (_: SecurityException) {
        hasBluetoothOutputs()
      }
    }
    return hasBluetoothOutputs() || isHeadsetProfileConnected()
  }

  private fun hasWired(): Boolean {
    if (Build.VERSION.SDK_INT >= 31) {
      return try {
        audio.availableCommunicationDevices.any(::isWiredDevice)
      } catch (_: Throwable) {
        false
      }
    }
    return try {
      @Suppress("DEPRECATION")
      audio.isWiredHeadsetOn ||
        audio.getDevices(AudioManager.GET_DEVICES_ALL).any(::isWiredDevice)
    } catch (_: Throwable) {
      false
    }
  }

  private fun hasBluetoothOutputs(): Boolean {
    return try {
      audio.getDevices(AudioManager.GET_DEVICES_ALL).any(::isBluetoothDevice)
    } catch (_: Throwable) {
      false
    }
  }

  private fun isHeadsetProfileConnected(): Boolean {
    return try {
      val mgr = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      val adapter: BluetoothAdapter = mgr?.adapter ?: BluetoothAdapter.getDefaultAdapter() ?: return false
      if (!adapter.isEnabled) return false
      val headset = adapter.getProfileConnectionState(BluetoothProfile.HEADSET)
      headset == BluetoothProfile.STATE_CONNECTED ||
        headset == BluetoothProfile.STATE_CONNECTING
    } catch (_: SecurityException) {
      false
    } catch (_: Throwable) {
      false
    }
  }

  private fun isBluetoothDevice(info: AudioDeviceInfo): Boolean {
    return when (info.type) {
      AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_HEARING_AID -> true
      else -> {
        if (Build.VERSION.SDK_INT >= 31) {
          info.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            info.type == AudioDeviceInfo.TYPE_BLE_SPEAKER
        } else {
          false
        }
      }
    }
  }

  private fun isWiredDevice(info: AudioDeviceInfo): Boolean {
    return when (info.type) {
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> true
      else -> {
        if (Build.VERSION.SDK_INT >= 26) {
          info.type == AudioDeviceInfo.TYPE_USB_HEADSET ||
            info.type == AudioDeviceInfo.TYPE_USB_DEVICE
        } else {
          false
        }
      }
    }
  }

  private fun findCommDevice(pred: (AudioDeviceInfo) -> Boolean): AudioDeviceInfo? {
    if (Build.VERSION.SDK_INT < 31) return null
    return try {
      audio.availableCommunicationDevices.firstOrNull(pred)
    } catch (_: SecurityException) {
      null
    }
  }

  private fun bindDeviceListeners() {
    unbindDeviceListeners()
    if (Build.VERSION.SDK_INT >= 23) {
      val cb = object : AudioDeviceCallback() {
        override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
          main.post { onDevicesChanged() }
        }

        override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
          main.post { onDevicesChanged() }
        }
      }
      audio.registerAudioDeviceCallback(cb, main)
      deviceCallback = cb
    }

    val sco = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (!active) return
        val state = intent?.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1) ?: return
        if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED && scoWanted && hasBluetooth()) {
          // Transient SCO drop — retry without tearing down the call or unpairing.
          main.post { startScoIfNeeded() }
        }
      }
    }
    val scoFilter = IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED)
    // System broadcasts — EXPORTED so SCO / headset plug still arrive on API 33+.
    if (Build.VERSION.SDK_INT >= 33) {
      ctx.registerReceiver(sco, scoFilter, Context.RECEIVER_EXPORTED)
    } else {
      ctx.registerReceiver(sco, scoFilter)
    }
    scoReceiver = sco

    val wired = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (active) main.post { onDevicesChanged() }
      }
    }
    val wiredFilter = IntentFilter(Intent.ACTION_HEADSET_PLUG)
    if (Build.VERSION.SDK_INT >= 33) {
      ctx.registerReceiver(wired, wiredFilter, Context.RECEIVER_EXPORTED)
    } else {
      ctx.registerReceiver(wired, wiredFilter)
    }
    wiredReceiver = wired
  }

  private fun unbindDeviceListeners() {
    deviceCallback?.let {
      try {
        audio.unregisterAudioDeviceCallback(it)
      } catch (_: Throwable) {
      }
    }
    deviceCallback = null
    scoReceiver?.let {
      try {
        ctx.unregisterReceiver(it)
      } catch (_: Throwable) {
      }
    }
    scoReceiver = null
    wiredReceiver?.let {
      try {
        ctx.unregisterReceiver(it)
      } catch (_: Throwable) {
      }
    }
    wiredReceiver = null
  }

  private fun requestFocus() {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        val attrs = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
          .setAudioAttributes(attrs)
          .setAcceptsDelayedFocusGain(true)
          .setOnAudioFocusChangeListener { }
          .build()
        focusRequest = req
        audio.requestAudioFocus(req)
      } else {
        @Suppress("DEPRECATION")
        audio.requestAudioFocus(
          null,
          AudioManager.STREAM_VOICE_CALL,
          AudioManager.AUDIOFOCUS_GAIN,
        )
      }
    } catch (_: Throwable) {
    }
  }

  private fun abandonFocus() {
    try {
      if (Build.VERSION.SDK_INT >= 26) {
        focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      } else {
        @Suppress("DEPRECATION")
        audio.abandonAudioFocus(null)
      }
    } catch (_: Throwable) {
    }
    focusRequest = null
  }

  private fun snapshotMap(): WritableMap {
    val map = Arguments.createMap()
    val routes: WritableArray = Arguments.createArray()
    for (r in availableRoutes()) routes.pushString(r)
    map.putArray("available", routes)
    map.putString("selected", if (active) selected else defaultIdleRoute())
    map.putBoolean("muted", muted)
    map.putBoolean("active", active)
    return map
  }

  private fun defaultIdleRoute(): String {
    return if (callType == "video") ROUTE_SPK else ROUTE_EAR
  }

  private fun emit() {
    if (!ctx.hasActiveReactInstance()) return
    try {
      ctx
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit(EVENT, snapshotMap())
    } catch (_: Throwable) {
    }
  }

  private fun runOnMain(block: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      block()
    } else {
      main.post(block)
    }
  }

  override fun invalidate() {
    runOnMain { if (active) teardown(keepBluetoothPaired = true) }
    super.invalidate()
  }
}
