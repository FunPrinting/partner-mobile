package expo.modules.printerdiscovery

import java.net.InetAddress
import java.net.URL
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * Manages TLS/SSL trust for local network printers.
 *
 * Consumer Wi-Fi printers (such as Epson L3250 series, HP Smart Tank, Canon MegaTank, Brother)
 * use self-signed TLS certificates on port 631 for encrypted IPPS printing.
 * This class trusts self-signed certificates ONLY for private local network addresses
 * (10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.0.0.1, and *.local mDNS hostnames).
 */
object LocalNetworkTrust {

  /** Returns true if the host is a local private network IP or .local mDNS hostname. */
  fun isLocalNetworkHost(host: String): Boolean {
    val clean = host.trim().lowercase().removePrefix("[").removeSuffix("]")
    if (clean == "localhost" || clean.endsWith(".local")) {
      return true
    }
    return try {
      val addr = InetAddress.getByName(clean)
      addr.isSiteLocalAddress || addr.isLoopbackAddress || addr.isLinkLocalAddress
    } catch (_: Exception) {
      clean.startsWith("192.168.") ||
        clean.startsWith("10.") ||
        clean.startsWith("127.") ||
        clean.matches(Regex("^172\\.(1[6-9]|2[0-9]|3[0-1])\\..*"))
    }
  }

  private val trustingX509 = object : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {}
    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
  }

  val localSslContext: SSLContext by lazy {
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, arrayOf<TrustManager>(trustingX509), SecureRandom())
    ctx
  }

  val localHostnameVerifier = HostnameVerifier { hostname, _ ->
    isLocalNetworkHost(hostname)
  }

  fun configureConnection(conn: java.net.URLConnection, url: URL) {
    if (conn is HttpsURLConnection && isLocalNetworkHost(url.host)) {
      conn.sslSocketFactory = localSslContext.socketFactory
      conn.hostnameVerifier = localHostnameVerifier
    }
  }
}

