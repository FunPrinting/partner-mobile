package expo.modules.printerdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

/**
 * Finds IPP printers on the local network (Bonjour / mDNS service types _ipp._tcp and _ipps._tcp)
 * and provides native in-app raster printing (PWG Raster 5102.4) and IPPS TLS communication.
 */
class PrinterDiscoveryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PrinterDiscovery")

    AsyncFunction("scan") { timeoutMs: Int, promise: Promise ->
      Scan(context, timeoutMs.toLong().coerceIn(1000, 15000)) { promise.resolve(it) }.start()
    }

    AsyncFunction("probePrinter") { address: String, promise: Promise ->
      Thread {
        try {
          val res = IppClient.probePrinter(address)
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("PROBE_FAILED", e.message ?: "Printer probe failed", e)
        }
      }.start()
    }

    AsyncFunction("sendIpp") { url: String, requestBase64: String, promise: Promise ->
      Thread {
        try {
          val reqBytes = Base64.decode(requestBase64, Base64.DEFAULT)
          val (code, respBytes) = IppClient.sendIpp(url, reqBytes)
          val respBase64 = Base64.encodeToString(respBytes, Base64.NO_WRAP)
          promise.resolve(
            mapOf(
              "status" to code,
              "responseBase64" to respBase64
            )
          )
        } catch (e: Exception) {
          promise.reject("IPP_SEND_FAILED", e.message ?: "IPP request failed", e)
        }
      }.start()
    }

    AsyncFunction("printRaster") { printerUrl: String, pdfUri: String, options: Map<String, Any?>, promise: Promise ->
      Thread {
        try {
          val res = IppClient.printRaster(context, printerUrl, pdfUri, options)
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("RASTER_PRINT_FAILED", e.message ?: "Raster printing failed", e)
        }
      }.start()
    }

    AsyncFunction("getJobStatus") { printerUrl: String, jobId: Int, promise: Promise ->
      Thread {
        try {
          val res = IppClient.getJobStatus(printerUrl, jobId)
          promise.resolve(res)
        } catch (e: Exception) {
          promise.reject("JOB_STATUS_FAILED", e.message ?: "Get job status failed", e)
        }
      }.start()
    }

    AsyncFunction("startStationService") { title: String, message: String, promise: Promise ->
      try {
        StationForegroundService.start(context, title, message)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("START_SERVICE_FAILED", e.message ?: "Failed to start station service", e)
      }
    }

    AsyncFunction("stopStationService") { promise: Promise ->
      try {
        StationForegroundService.stop(context)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("STOP_SERVICE_FAILED", e.message ?: "Failed to stop station service", e)
      }
    }

    AsyncFunction("isStationServiceRunning") { promise: Promise ->
      promise.resolve(StationForegroundService.isServiceRunning())
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      val activity = appContext.currentActivity
      if (Build.VERSION.SDK_INT >= 33 && activity != null) {
        if (activity.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
          activity.requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), 4002)
        }
      }
      promise.resolve(true)
    }
  }
}

private class Scan(
  private val context: Context,
  private val timeoutMs: Long,
  private val done: (List<Map<String, Any?>>) -> Unit
) {
  private val main = Handler(Looper.getMainLooper())
  private val nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
  private val results = LinkedHashMap<String, Map<String, Any?>>()
  private val pending = ArrayDeque<NsdServiceInfo>()
  private val listeners = ArrayList<NsdManager.DiscoveryListener>()
  private var resolving = false
  private var finished = false
  private var lock: WifiManager.MulticastLock? = null

  fun start() {
    main.post {
      try {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        lock = wifi.createMulticastLock("funprinting-printer-discovery").apply {
          setReferenceCounted(false)
          acquire()
        }
      } catch (_: Exception) {
      }
      for (type in listOf("_ipp._tcp", "_ipps._tcp")) {
        val listener = object : NsdManager.DiscoveryListener {
          override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {}
          override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
          override fun onDiscoveryStarted(serviceType: String) {}
          override fun onDiscoveryStopped(serviceType: String) {}
          override fun onServiceLost(info: NsdServiceInfo) {}
          override fun onServiceFound(info: NsdServiceInfo) {
            main.post {
              if (!finished) {
                pending.add(info)
                resolveNext()
              }
            }
          }
        }
        listeners.add(listener)
        try {
          nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (_: Exception) {
        }
      }
      main.postDelayed({ finish() }, timeoutMs)
    }
  }

  private fun resolveNext() {
    if (resolving || finished) return
    val info = pending.poll() ?: return
    resolving = true
    try {
      @Suppress("DEPRECATION")
      nsd.resolveService(info, object : NsdManager.ResolveListener {
        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
          main.post {
            resolving = false
            resolveNext()
          }
        }

        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
          main.post {
            record(serviceInfo)
            resolving = false
            resolveNext()
          }
        }
      })
    } catch (_: Exception) {
      resolving = false
      resolveNext()
    }
  }

  private fun record(info: NsdServiceInfo) {
    val addresses = ArrayList<String>()
    if (Build.VERSION.SDK_INT >= 34) {
      info.hostAddresses.forEach { it.hostAddress?.let(addresses::add) }
    } else {
      @Suppress("DEPRECATION")
      info.host?.hostAddress?.let(addresses::add)
    }
    val usable = addresses.map { it.substringBefore('%') }.filter { !it.startsWith("fe80:") && !it.startsWith("169.254.") }
    val txt = HashMap<String, String>()
    for ((k, v) in info.attributes) txt[k] = if (v == null) "" else String(v, Charsets.UTF_8)
    val type = if (info.serviceType.contains("_ipps")) "ipps" else "ipp"
    results["$type|${info.serviceName}"] = mapOf(
      "name" to info.serviceName,
      "type" to type,
      "port" to info.port,
      "addresses" to usable,
      "txt" to txt
    )
  }

  private fun finish() {
    if (finished) return
    finished = true
    for (l in listeners) {
      try {
        nsd.stopServiceDiscovery(l)
      } catch (_: Exception) {
      }
    }
    try {
      lock?.release()
    } catch (_: Exception) {
    }
    done(results.values.toList())
  }
}
