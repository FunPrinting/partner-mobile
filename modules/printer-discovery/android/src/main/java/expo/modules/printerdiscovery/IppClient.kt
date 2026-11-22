package expo.modules.printerdiscovery

import android.content.Context
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Native IPP 1.1 client with TLS self-signed certificate trust and PWG Raster streaming.
 */
object IppClient {

  private const val TIMEOUT_MS = 15000

  fun openConnection(urlString: String, timeoutMs: Int = TIMEOUT_MS): HttpURLConnection {
    val url = URL(urlString)
    val conn = url.openConnection() as HttpURLConnection
    LocalNetworkTrust.configureConnection(conn, url)
    conn.connectTimeout = timeoutMs
    conn.readTimeout = 60000
    conn.setRequestProperty("Content-Type", "application/ipp")
    conn.setRequestProperty("Accept", "application/ipp")
    return conn
  }

  fun sendIpp(urlStr: String, requestBytes: ByteArray): Pair<Int, ByteArray> {
    var targetUrl = urlStr
    if (targetUrl.startsWith("ipp://", ignoreCase = true)) {
      targetUrl = "http://" + targetUrl.substring(6)
    } else if (targetUrl.startsWith("ipps://", ignoreCase = true)) {
      targetUrl = "https://" + targetUrl.substring(7)
    }

    fun execute(u: String): Pair<Int, ByteArray> {
      val conn = openConnection(u)
      try {
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setFixedLengthStreamingMode(requestBytes.size)
        conn.outputStream.use { it.write(requestBytes) }

        val code = conn.responseCode
        if (code == 426 && u.startsWith("http://", ignoreCase = true)) {
          conn.disconnect()
          val httpsUrl = "https://" + u.substring(7)
          return execute(httpsUrl)
        }

        val stream: InputStream = if (code in 200..299) {
          conn.inputStream
        } else {
          conn.errorStream ?: conn.inputStream
        }
        val body = stream.use { it.readBytes() }
        return Pair(code, body)
      } finally {
        conn.disconnect()
      }
    }

    return execute(targetUrl)
  }

  /**
   * Probes the printer address for IPP/IPPS capabilities.
   * Tests HTTPS on port 631 first (standard for modern printers like Epson L-series),
   * followed by HTTP with auto-upgrade on 426.
   */
  fun probePrinter(address: String): Map<String, Any?> {
    var raw = address.trim()
    val isExplicitHttps = raw.startsWith("https://", ignoreCase = true) || raw.startsWith("ipps://", ignoreCase = true)
    raw = raw.replace(Regex("^(ipps?|https?):\\/\\/", RegexOption.IGNORE_CASE), "")

    val slashIdx = raw.indexOf('/')
    val hostPort = if (slashIdx == -1) raw else raw.substring(0, slashIdx)
    val initialPath = if (slashIdx == -1) "/ipp/print" else raw.substring(slashIdx)

    val colonIdx = hostPort.lastIndexOf(':')
    val hasPort = colonIdx != -1 && !hostPort.startsWith("[")
    val host = if (hasPort) hostPort.substring(0, colonIdx) else hostPort
    val port = if (hasPort) hostPort.substring(colonIdx + 1).toIntOrNull() ?: 631 else 631

    val candidatePaths = listOf(
      initialPath,
      "/ipp/print",
      "/ipp/printer",
      "/printers/ipp",
      "/"
    ).distinct()

    val candidates = mutableListOf<String>()
    if (isExplicitHttps) {
      for (p in candidatePaths) {
        candidates.add("https://$host:$port$p")
        candidates.add("http://$host:$port$p")
      }
    } else {
      for (p in candidatePaths) {
        candidates.add("http://$host:$port$p")
        candidates.add("https://$host:$port$p")
      }
    }

    var lastException: Exception? = null

    for (cand in candidates.distinct()) {
      try {
        val ippUri = cand.replace(Regex("^https?://", RegexOption.IGNORE_CASE)) {
          if (it.value.startsWith("https", ignoreCase = true)) "ipps://" else "ipp://"
        }
        val reqBytes = buildGetPrinterAttributesRequest(ippUri)
        val (httpStatus, respBytes) = sendIpp(cand, reqBytes)

        if (httpStatus in 200..299 && respBytes.size >= 8) {
          val parsed = decodeIppResponse(respBytes)
          if (parsed.statusCode in 0x0000..0x00FF) {
            val p = parsed.printerAttributes
            val name = (p["printer-make-and-model"]?.firstOrNull()
              ?: p["printer-name"]?.firstOrNull()
              ?: "Wi-Fi Printer").toString()

            val stateVal = (p["printer-state"]?.firstOrNull() as? Number)?.toInt() ?: 0
            val state = when (stateVal) {
              3 -> "idle"
              4 -> "printing"
              5 -> "stopped"
              else -> "unknown"
            }
            val accepting = p["printer-is-accepting-jobs"]?.firstOrNull() != false
            val formats = (p["document-format-supported"] ?: emptyList()).map { it.toString() }
            val colorModes = (p["print-color-mode-supported"] ?: emptyList()).map { it.toString() }
            val sides = (p["sides-supported"] ?: emptyList()).map { it.toString() }
            val media = (p["media-supported"] ?: emptyList()).map { it.toString() }
            val uuid = p["printer-uuid"]?.firstOrNull()?.toString()?.replace(Regex("^urn:uuid:", RegexOption.IGNORE_CASE), "")?.lowercase()

            return mapOf(
              "success" to true,
              "name" to name,
              "state" to state,
              "accepting" to accepting,
              "formats" to formats,
              "colorModes" to colorModes,
              "sides" to sides,
              "media" to media,
              "uuid" to uuid,
              "resolvedUrl" to cand,
              "useTls" to cand.startsWith("https://", ignoreCase = true)
            )
          }
        }
      } catch (e: Exception) {
        lastException = e
      }
    }

    throw lastException ?: Exception("Printer not reachable at $address")
  }

  /**
   * Direct In-App Host printing:
   * Rasterizes the PDF file to PWG 5102.4 raster format on-the-fly and streams directly
   * over IPPS/IPP to the printer.
   */
  fun printRaster(
    context: Context,
    printerUrl: String,
    pdfUri: String,
    options: Map<String, Any?>
  ): Map<String, Any?> {
    var targetUrl = printerUrl.trim()
    if (targetUrl.startsWith("ipp://", ignoreCase = true)) {
      targetUrl = "http://" + targetUrl.substring(6)
    } else if (targetUrl.startsWith("ipps://", ignoreCase = true)) {
      targetUrl = "https://" + targetUrl.substring(7)
    }

    val copies = ((options["copies"] as? Number)?.toInt() ?: 1).coerceIn(1, 99)
    val color = (options["color"] as? String) ?: "color"
    val sided = (options["sided"] as? String) ?: "single"
    val pageSize = (options["pageSize"] as? String) ?: "A4"
    val jobName = (options["jobName"] as? String) ?: "FunPrinting Job"
    val dpi = ((options["dpi"] as? Number)?.toInt() ?: 300).coerceIn(150, 600)
    val reverseOrder = (options["reverseOrder"] as? Boolean) ?: true
    val scaling = (options["scaling"] as? String) ?: "fit"

    val pages = (options["pages"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }
    val colorPages = (options["colorPages"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }

    fun streamJob(url: String): Map<String, Any?> {
      val conn = openConnection(url, timeoutMs = 30000)
      try {
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.setChunkedStreamingMode(65536)

        val ippUri = url.replace(Regex("^https?://", RegexOption.IGNORE_CASE)) {
          if (it.value.startsWith("https", ignoreCase = true)) "ipps://" else "ipp://"
        }

        // 1. Write IPP Print-Job request header & attributes
        writePrintJobHeader(
          out = conn.outputStream,
          printerUri = ippUri,
          jobName = jobName,
          format = "image/pwg-raster",
          copies = copies,
          sided = sided,
          color = color,
          pageSize = pageSize,
          scaling = scaling
        )

        // 2. Stream PWG raster from PDF directly into the socket
        PwgRasterEncoder.encodePdfToStream(
          context = context,
          pdfFileOrUri = pdfUri,
          outputStream = conn.outputStream,
          pageNumbers = pages,
          dpi = dpi,
          jobColor = color,
          colorPages = colorPages,
          isDuplex = (sided == "double"),
          pageSizeName = if (pageSize == "A3") "iso_a3_297x420mm" else "iso_a4_210x297mm",
          reverseOrder = reverseOrder,
          scaling = scaling
        )

        conn.outputStream.flush()
        conn.outputStream.close()

        val code = conn.responseCode
        if (code == 426 && url.startsWith("http://", ignoreCase = true)) {
          conn.disconnect()
          val httpsUrl = "https://" + url.substring(7)
          return streamJob(httpsUrl)
        }

        val stream: InputStream = if (code in 200..299) {
          conn.inputStream
        } else {
          conn.errorStream ?: conn.inputStream
        }
        val respBytes = stream.use { it.readBytes() }

        val parsed = decodeIppResponse(respBytes)
        if (parsed.statusCode !in 0x0000..0x00FF) {
          throw Exception("Printer rejected job: IPP status 0x${parsed.statusCode.toString(16)}")
        }

        val jobId = (parsed.jobAttributes["job-id"]?.firstOrNull() as? Number)?.toInt() ?: 0
        return mapOf(
          "success" to true,
          "jobId" to jobId,
          "statusCode" to parsed.statusCode,
          "message" to "Job sent successfully"
        )
      } catch (e: Exception) {
        if (url.startsWith("http://", ignoreCase = true)) {
          // If plain HTTP was reset by printer or failed, retry automatically via TLS/HTTPS
          try {
            conn.disconnect()
            val httpsUrl = "https://" + url.substring(7)
            return streamJob(httpsUrl)
          } catch (_: Exception) {
            throw e
          }
        } else if (url.startsWith("https://", ignoreCase = true)) {
          // If TLS/HTTPS had a connection reset or failed, retry automatically via plain HTTP
          try {
            conn.disconnect()
            val httpUrl = "http://" + url.substring(8)
            return streamJob(httpUrl)
          } catch (_: Exception) {
            throw e
          }
        }
        throw e
      } finally {
        conn.disconnect()
      }
    }

    return streamJob(targetUrl)
  }

  fun getJobStatus(printerUrl: String, jobId: Int): Map<String, Any?> {
    var targetUrl = printerUrl.trim()
    if (targetUrl.startsWith("ipp://", ignoreCase = true)) {
      targetUrl = "http://" + targetUrl.substring(6)
    } else if (targetUrl.startsWith("ipps://", ignoreCase = true)) {
      targetUrl = "https://" + targetUrl.substring(7)
    }

    val ippUri = targetUrl.replace(Regex("^https?://", RegexOption.IGNORE_CASE)) {
      if (it.value.startsWith("https", ignoreCase = true)) "ipps://" else "ipp://"
    }
    val reqBytes = buildGetJobAttributesRequest(ippUri, jobId)
    val (code, respBytes) = sendIpp(targetUrl, reqBytes)

    if (code in 200..299 && respBytes.size >= 8) {
      val parsed = decodeIppResponse(respBytes)
      val state = (parsed.jobAttributes["job-state"]?.firstOrNull() as? Number)?.toInt() ?: 0
      val reasons = (parsed.jobAttributes["job-state-reasons"] ?: emptyList()).map { it.toString() }
      return mapOf(
        "state" to state,
        "stateReasons" to reasons
      )
    }
    return mapOf("state" to 0, "stateReasons" to emptyList<String>())
  }

  // ── Binary IPP Builders ────────────────────────────────────────────────

  private fun buildGetPrinterAttributesRequest(printerUri: String): ByteArray {
    val baos = ByteArrayOutputStream()
    val bb = ByteBuffer.allocate(1024).order(ByteOrder.BIG_ENDIAN)

    bb.put(1.toByte())
    bb.put(1.toByte())
    bb.putShort(0x000B.toShort()) // Get-Printer-Attributes
    bb.putInt(1) // Request ID

    bb.put(0x01.toByte()) // Operation group
    writeAttr(bb, 0x47, "attributes-charset", "utf-8")
    writeAttr(bb, 0x48, "attributes-natural-language", "en")
    writeAttr(bb, 0x45, "printer-uri", printerUri)
    writeAttr(bb, 0x42, "requesting-user-name", "FunPrinting")

    // requested-attributes
    val attrs = listOf(
      "printer-name",
      "printer-make-and-model",
      "printer-uuid",
      "printer-state",
      "printer-state-reasons",
      "printer-is-accepting-jobs",
      "document-format-supported",
      "sides-supported",
      "print-color-mode-supported",
      "media-supported"
    )
    for (i in attrs.indices) {
      val attrName = if (i == 0) "requested-attributes" else ""
      writeAttr(bb, 0x44, attrName, attrs[i])
    }

    bb.put(0x03.toByte()) // End tag
    baos.write(bb.array(), 0, bb.position())
    return baos.toByteArray()
  }

  private fun buildGetJobAttributesRequest(printerUri: String, jobId: Int): ByteArray {
    val baos = ByteArrayOutputStream()
    val bb = ByteBuffer.allocate(512).order(ByteOrder.BIG_ENDIAN)

    bb.put(1.toByte())
    bb.put(1.toByte())
    bb.putShort(0x0009.toShort()) // Get-Job-Attributes
    bb.putInt(1)

    bb.put(0x01.toByte())
    writeAttr(bb, 0x47, "attributes-charset", "utf-8")
    writeAttr(bb, 0x48, "attributes-natural-language", "en")
    writeAttr(bb, 0x45, "printer-uri", printerUri)
    writeIntAttr(bb, 0x21, "job-id", jobId)

    writeAttr(bb, 0x44, "requested-attributes", "job-state")
    writeAttr(bb, 0x44, "", "job-state-reasons")

    bb.put(0x03.toByte())
    baos.write(bb.array(), 0, bb.position())
    return baos.toByteArray()
  }

  private fun writePrintJobHeader(
    out: OutputStream,
    printerUri: String,
    jobName: String,
    format: String,
    copies: Int,
    sided: String,
    color: String,
    pageSize: String,
    scaling: String = "fit"
  ) {
    val bb = ByteBuffer.allocate(2048).order(ByteOrder.BIG_ENDIAN)

    bb.put(1.toByte())
    bb.put(1.toByte())
    bb.putShort(0x0002.toShort()) // Print-Job
    bb.putInt(1)

    // Operation group
    bb.put(0x01.toByte())
    writeAttr(bb, 0x47, "attributes-charset", "utf-8")
    writeAttr(bb, 0x48, "attributes-natural-language", "en")
    writeAttr(bb, 0x45, "printer-uri", printerUri)
    writeAttr(bb, 0x42, "requesting-user-name", "FunPrinting")
    writeAttr(bb, 0x42, "job-name", jobName.take(255))
    writeAttr(bb, 0x49, "document-format", format)

    // Job group
    bb.put(0x02.toByte())
    if (copies > 1) {
      writeIntAttr(bb, 0x21, "copies", copies)
    }
    val sidesKeyword = if (sided == "double") "two-sided-long-edge" else "one-sided"
    writeAttr(bb, 0x44, "sides", sidesKeyword)

    val colorKeyword = when (color.lowercase()) {
      "bw" -> "monochrome"
      "mixed" -> "auto"
      else -> "color"
    }
    writeAttr(bb, 0x44, "print-color-mode", colorKeyword)

    val mediaKeyword = if (pageSize == "A3") "iso_a3_297x420mm" else "iso_a4_210x297mm"
    writeAttr(bb, 0x44, "media", mediaKeyword)

    // Standard IPP print-scaling keyword (PWG 5100.16)
    val scalingKeyword = when (scaling.lowercase()) {
      "none" -> "none"
      "shrink" -> "auto-fit"
      "fill" -> "fill"
      else -> "fit"
    }
    writeAttr(bb, 0x44, "print-scaling", scalingKeyword)

    // End tag
    bb.put(0x03.toByte())

    out.write(bb.array(), 0, bb.position())
  }

  private fun writeAttr(bb: ByteBuffer, tag: Int, name: String, value: String) {
    bb.put(tag.toByte())
    val nameBytes = name.toByteArray(Charsets.UTF_8)
    bb.putShort(nameBytes.size.toShort())
    bb.put(nameBytes)
    val valBytes = value.toByteArray(Charsets.UTF_8)
    bb.putShort(valBytes.size.toShort())
    bb.put(valBytes)
  }

  private fun writeIntAttr(bb: ByteBuffer, tag: Int, name: String, value: Int) {
    bb.put(tag.toByte())
    val nameBytes = name.toByteArray(Charsets.UTF_8)
    bb.putShort(nameBytes.size.toShort())
    bb.put(nameBytes)
    bb.putShort(4.toShort())
    bb.putInt(value)
  }

  // ── Binary IPP Parser ──────────────────────────────────────────────────

  data class ParsedIppResponse(
    val statusCode: Int,
    val requestId: Int,
    val printerAttributes: MutableMap<String, MutableList<Any>> = mutableMapOf(),
    val jobAttributes: MutableMap<String, MutableList<Any>> = mutableMapOf()
  )

  fun decodeIppResponse(buf: ByteArray): ParsedIppResponse {
    if (buf.size < 8) throw IllegalArgumentException("IPP response too short: ${buf.size} bytes")
    val bb = ByteBuffer.wrap(buf).order(ByteOrder.BIG_ENDIAN)
    val major = bb.get()
    val minor = bb.get()
    val statusCode = bb.short.toInt() and 0xFFFF
    val requestId = bb.int

    val res = ParsedIppResponse(statusCode, requestId)
    var currentGroup: MutableMap<String, MutableList<Any>>? = null
    var lastName = ""

    while (bb.hasRemaining()) {
      val tag = bb.get().toInt() and 0xFF
      if (tag == 0x03) break // End tag
      if (tag <= 0x0F) {
        currentGroup = when (tag) {
          0x02 -> res.jobAttributes
          0x04 -> res.printerAttributes
          else -> null
        }
        continue
      }

      if (bb.remaining() < 2) break
      val nameLen = bb.short.toInt() and 0xFFFF
      val name = if (nameLen > 0 && bb.remaining() >= nameLen) {
        val b = ByteArray(nameLen)
        bb.get(b)
        String(b, Charsets.UTF_8)
      } else ""

      if (bb.remaining() < 2) break
      val valLen = bb.short.toInt() and 0xFFFF
      val valBytes = if (valLen > 0 && bb.remaining() >= valLen) {
        val b = ByteArray(valLen)
        bb.get(b)
        b
      } else ByteArray(0)

      if (name.isNotEmpty()) {
        lastName = name
      }

      val value: Any = when {
        (tag == 0x21 || tag == 0x23) && valBytes.size == 4 -> {
          ByteBuffer.wrap(valBytes).order(ByteOrder.BIG_ENDIAN).int
        }
        tag == 0x22 && valBytes.isNotEmpty() -> {
          valBytes[0].toInt() == 1
        }
        else -> {
          String(valBytes, Charsets.UTF_8)
        }
      }

      if (currentGroup != null && lastName.isNotEmpty()) {
        currentGroup.getOrPut(lastName) { mutableListOf() }.add(value)
      }
    }

    return res
  }
}

