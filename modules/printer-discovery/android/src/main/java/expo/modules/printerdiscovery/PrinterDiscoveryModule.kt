package expo.modules.printerdiscovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.ArrayDeque

/**
 * Finds IPP printers on the local network (Bonjour / mDNS service types _ipp._tcp and
 * _ipps._tcp) with Android's NsdManager.
 *
 * scan(timeoutMs) resolves with one record per service found:
 *   { name, type: "ipp" | "ipps", port, addresses: string[], txt: { key: value } }
 */
class PrinterDiscoveryModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PrinterDiscovery")

    AsyncFunction("scan") { timeoutMs: Int, promise: Promise ->
      Scan(context, timeoutMs.toLong().coerceIn(1000, 15000)) { promise.resolve(it) }.start()
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
        // Without this lock many phones drop incoming multicast packets and see nothing
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        lock = wifi.createMulticastLock("funprinting-printer-discovery").apply {
          setReferenceCounted(false)
          acquire()
        }
      } catch (_: Exception) {
        // Discovery may still work without it
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
          // this type cannot be browsed right now
        }
      }
      main.postDelayed({ finish() }, timeoutMs)
    }
  }

  // Android resolves one service at a time
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
    // Link-local addresses (fe80::) are no use outside this interface
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
        // not started or already stopped
      }
    }
    try {
      lock?.release()
    } catch (_: Exception) {
    }
    done(results.values.toList())
  }
}
