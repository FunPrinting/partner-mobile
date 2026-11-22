package expo.modules.printerdiscovery

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Native PWG Raster 5102.4 encoder.
 *
 * Converts PDF pages into standard PWG Raster format ("image/pwg-raster")
 * accepted natively by consumer Wi-Fi ink-tank printers (such as Epson L3250 series).
 *
 * Encodes pages using:
 * - 4-byte file sync word: "RaS2" (0x52, 0x61, 0x53, 0x32)
 * - 1796-byte CUPS/PWG page header per page
 * - Line repeat count byte (0..255 for 1..256 repeated lines)
 * - PackBits run-length compression per scanline
 * - Constant-memory streaming (recycles each page bitmap immediately)
 */
object PwgRasterEncoder {

  private val SYNC_WORD = byteArrayOf(
    'R'.code.toByte(),
    'a'.code.toByte(),
    'S'.code.toByte(),
    '2'.code.toByte()
  )

  /**
   * Constructs the 1796-byte PWG 5102.4 page header matching cups_page_header2_t.
   */
  fun createPageHeader(
    widthPixels: Int,
    heightPixels: Int,
    pageWidthPoints: Int,
    pageHeightPoints: Int,
    dpi: Int = 300,
    isColor: Boolean = true,
    isDuplex: Boolean = false,
    pageSizeName: String = "iso_a4_210x297mm",
    totalPages: Int = 1
  ): ByteArray {
    val header = ByteArray(1796)
    val buf = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN)

    // MediaClass: "PwgRaster\0" at offset 0
    val mediaClass = "PwgRaster".toByteArray(Charsets.US_ASCII)
    System.arraycopy(mediaClass, 0, header, 0, mediaClass.size)

    // Duplex at offset 272 (4 bytes unsigned int)
    buf.putInt(272, if (isDuplex) 1 else 0)

    // HWResolution[2] at offset 276: [dpi, dpi]
    buf.putInt(276, dpi)
    buf.putInt(280, dpi)

    // PageSize[2] at offset 352: [pageWidthPoints, pageHeightPoints]
    buf.putInt(352, pageWidthPoints)
    buf.putInt(356, pageHeightPoints)

    // cupsWidth at offset 372
    buf.putInt(372, widthPixels)

    // cupsHeight at offset 376
    buf.putInt(376, heightPixels)

    // cupsBitsPerColor at offset 384: 8
    buf.putInt(384, 8)

    // cupsBitsPerPixel at offset 388: 24 for sRGB, 8 for sGray
    val bitsPerPixel = if (isColor) 24 else 8
    buf.putInt(388, bitsPerPixel)

    // cupsBytesPerLine at offset 392: widthPixels * bitsPerPixel / 8
    val bytesPerLine = widthPixels * (if (isColor) 3 else 1)
    buf.putInt(392, bytesPerLine)

    // cupsColorOrder at offset 396: 0 (CUPS_ORDER_CHUNKED)
    buf.putInt(396, 0)

    // cupsColorSpace at offset 400: 19 (CUPS_CSPACE_SRGB) or 18 (CUPS_CSPACE_SW / sGray)
    val colorSpace = if (isColor) 19 else 18
    buf.putInt(400, colorSpace)

    // cupsNumColors at offset 420: 3 for sRGB, 1 for sGray
    buf.putInt(420, if (isColor) 3 else 1)

    // cupsPageSize[2] float at offset 428
    buf.putFloat(428, pageWidthPoints.toFloat())
    buf.putFloat(432, pageHeightPoints.toFloat())

    // cupsImagingBBox[4] float at offset 436: [0, 0, width, height]
    buf.putFloat(436, 0f)
    buf.putFloat(440, 0f)
    buf.putFloat(444, pageWidthPoints.toFloat())
    buf.putFloat(448, pageHeightPoints.toFloat())

    // cupsInteger[16] at offset 452
    // cupsInteger[0]: TotalPageCount
    buf.putInt(452, totalPages)
    // cupsInteger[1]: CrossFeedTransform (1)
    buf.putInt(456, 1)
    // cupsInteger[2]: FeedTransform (1)
    buf.putInt(460, 1)
    // cupsInteger[3]: ImageBoxLeft (0)
    buf.putInt(464, 0)
    // cupsInteger[4]: ImageBoxTop (0)
    buf.putInt(468, 0)
    // cupsInteger[5]: ImageBoxRight (widthPixels)
    buf.putInt(472, widthPixels)
    // cupsInteger[6]: ImageBoxBottom (heightPixels)
    buf.putInt(476, heightPixels)
    // cupsInteger[7]: AlternatePrimary (0)
    buf.putInt(480, 0)
    // cupsInteger[8]: PrintQuality (4 = normal)
    buf.putInt(484, 4)

    // cupsPageSizeName at offset 1732 (64 bytes)
    val nameBytes = pageSizeName.toByteArray(Charsets.US_ASCII)
    val nameLen = Math.min(nameBytes.size, 63)
    System.arraycopy(nameBytes, 0, header, 1732, nameLen)

    return header
  }

  /**
   * Renders PDF pages directly with Android's PdfRenderer and streams PWG raster to out.
   */
  fun encodePdfToStream(
    context: Context,
    pdfFileOrUri: String,
    outputStream: OutputStream,
    pageNumbers: List<Int>? = null, // 1-based, null means all pages
    dpi: Int = 300,
    jobColor: String = "color", // "bw", "color", "mixed"
    colorPages: List<Int>? = null, // 1-based document page numbers that are in color
    isDuplex: Boolean = false,
    pageSizeName: String = "iso_a4_210x297mm",
    reverseOrder: Boolean = true,
    scaling: String = "fit"
  ) {
    val uri = if (pdfFileOrUri.startsWith("content://") || pdfFileOrUri.startsWith("file://")) {
      Uri.parse(pdfFileOrUri)
    } else {
      Uri.fromFile(File(pdfFileOrUri))
    }

    val pfd: ParcelFileDescriptor = if (uri.scheme == "content") {
      context.contentResolver.openFileDescriptor(uri, "r")
        ?: throw IllegalArgumentException("Cannot open content URI: $pdfFileOrUri")
    } else {
      val path = uri.path ?: pdfFileOrUri
      val file = File(path)
      if (!file.exists()) throw IllegalArgumentException("File not found: $path")
      ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    val renderer = PdfRenderer(pfd)
    try {
      val totalDocPages = renderer.pageCount
      val targetPages = if (pageNumbers != null && pageNumbers.isNotEmpty()) {
        pageNumbers.map { it - 1 }.filter { it in 0 until totalDocPages }
      } else {
        (0 until totalDocPages).toList()
      }

      if (targetPages.isEmpty()) {
        throw IllegalArgumentException("No valid pages to print (document has $totalDocPages pages)")
      }

      // LIFO Stack page ordering for face-up printer output (e.g. Epson L3250):
      // When reverseOrder is true, print from Page N down to Page 1 so Page 1 finishes on top of the tray.
      val orderedPages = if (reverseOrder) {
        if (isDuplex && targetPages.size > 1) {
          // For duplex, reverse by 2-page sheet units (Sheet K, Sheet K-1, ..., Sheet 1)
          val sheets = mutableListOf<List<Int>>()
          var idx = 0
          while (idx < targetPages.size) {
            val sheet = if (idx + 1 < targetPages.size) listOf(targetPages[idx], targetPages[idx + 1]) else listOf(targetPages[idx])
            sheets.add(sheet)
            idx += 2
          }
          sheets.reversed().flatten()
        } else {
          targetPages.reversed()
        }
      } else {
        targetPages
      }

      // In-colour page lookup for mixed jobs (1-based page numbers from source document)
      val inColor = colorPages?.filter { it >= 1 }?.toSet()

      // Standard ISO A4 (210x297mm = 595.28x841.89pt) and A3 (297x420mm = 841.89x1190.55pt)
      val isA3 = pageSizeName.contains("a3", ignoreCase = true)
      val mediaWidthPt = if (isA3) 841.8898f else 595.2756f
      val mediaHeightPt = if (isA3) 1190.5512f else 841.8898f
      val mediaWidthPx = Math.round(mediaWidthPt * dpi / 72f)
      val mediaHeightPx = Math.round(mediaHeightPt * dpi / 72f)

      // 1. Write the 4-byte PWG file synchronization word
      outputStream.write(SYNC_WORD)

      // 2. Encode each page onto the physical media canvas
      for (pageIdx in orderedPages) {
        val docPageNumber = pageIdx + 1
        val page = renderer.openPage(pageIdx)
        val docWidthPt = page.width.toFloat()
        val docHeightPt = page.height.toFloat()

        val bitmap = Bitmap.createBitmap(mediaWidthPx, mediaHeightPx, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.WHITE)

        val matrix = android.graphics.Matrix()
        when (scaling.lowercase()) {
          "none" -> {
            // 1:1 Scale (Actual Size 100%): 1 pt = dpi / 72 pixels, centered on sheet
            val scale = dpi / 72f
            val renderedW = docWidthPt * scale
            val renderedH = docHeightPt * scale
            val offsetX = (mediaWidthPx - renderedW) / 2f
            val offsetY = (mediaHeightPx - renderedH) / 2f
            matrix.postScale(scale, scale)
            matrix.postTranslate(offsetX, offsetY)
          }
          "shrink" -> {
            // Shrink Oversized: only downscales if page exceeds printable area, keeps 100% actual size otherwise
            val marginPt = 8.5039f // 3 mm in points
            val marginPx = Math.round(marginPt * dpi / 72f)
            val availWidthPx = (mediaWidthPx - 2 * marginPx).coerceAtLeast(1)
            val availHeightPx = (mediaHeightPx - 2 * marginPx).coerceAtLeast(1)

            val scaleX = availWidthPx.toFloat() / (docWidthPt * dpi / 72f)
            val scaleY = availHeightPx.toFloat() / (docHeightPt * dpi / 72f)
            val fitRatio = Math.min(1.0f, Math.min(scaleX, scaleY))
            val finalScale = (dpi / 72f) * fitRatio

            val renderedW = docWidthPt * finalScale
            val renderedH = docHeightPt * finalScale
            val offsetX = (mediaWidthPx - renderedW) / 2f
            val offsetY = (mediaHeightPx - renderedH) / 2f
            matrix.postScale(finalScale, finalScale)
            matrix.postTranslate(offsetX, offsetY)
          }
          "fill" -> {
            // Fit Paper (Fill / Bleed): scales uniformly to cover entire physical sheet edge-to-edge
            val paperScaleX = mediaWidthPx.toFloat() / (docWidthPt * dpi / 72f)
            val paperScaleY = mediaHeightPx.toFloat() / (docHeightPt * dpi / 72f)
            val fillRatio = Math.max(paperScaleX, paperScaleY)
            val finalScale = (dpi / 72f) * fillRatio

            val renderedW = docWidthPt * finalScale
            val renderedH = docHeightPt * finalScale
            val offsetX = (mediaWidthPx - renderedW) / 2f
            val offsetY = (mediaHeightPx - renderedH) / 2f
            matrix.postScale(finalScale, finalScale)
            matrix.postTranslate(offsetX, offsetY)
          }
          else -> {
            // "fit": Fit to Printable Area (default & safe for documents)
            // Hardware non-printable margins for consumer Wi-Fi inkjets (e.g. Epson L3250) are ~3mm (8.5 pt)
            val marginPt = 8.5039f // 3 mm in points
            val marginPx = Math.round(marginPt * dpi / 72f)
            val availWidthPx = (mediaWidthPx - 2 * marginPx).coerceAtLeast(1)
            val availHeightPx = (mediaHeightPx - 2 * marginPx).coerceAtLeast(1)

            val scaleX = availWidthPx.toFloat() / (docWidthPt * dpi / 72f)
            val scaleY = availHeightPx.toFloat() / (docHeightPt * dpi / 72f)
            val fitRatio = Math.min(scaleX, scaleY)
            val finalScale = (dpi / 72f) * fitRatio

            val renderedW = docWidthPt * finalScale
            val renderedH = docHeightPt * finalScale
            val offsetX = (mediaWidthPx - renderedW) / 2f
            val offsetY = (mediaHeightPx - renderedH) / 2f
            matrix.postScale(finalScale, finalScale)
            matrix.postTranslate(offsetX, offsetY)
          }
        }

        page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
        page.close()

        // Per-Page Color Determination:
        // - "bw" job: always 8-bit sGray (fires all 180 black nozzles at ~16 scrolls)
        // - "color" job: always 24-bit sRGB (fires color nozzles at ~34 scrolls)
        // - "mixed" job: checks inColor page set (or auto-scans bitmap if inColor is null).
        //   In duplex, both sides of a physical sheet share color mode if either has color.
        val pageIsColor = when (jobColor.lowercase()) {
          "bw" -> false
          "color" -> true
          else -> {
            if (inColor != null) {
              if (isDuplex) {
                val sheetStart = if (docPageNumber % 2 == 1) docPageNumber else docPageNumber - 1
                (sheetStart in inColor) || ((sheetStart + 1) in inColor)
              } else {
                docPageNumber in inColor
              }
            } else {
              hasColorPixels(bitmap)
            }
          }
        }

        val header = createPageHeader(
          widthPixels = mediaWidthPx,
          heightPixels = mediaHeightPx,
          pageWidthPoints = Math.round(mediaWidthPt),
          pageHeightPoints = Math.round(mediaHeightPt),
          dpi = dpi,
          isColor = pageIsColor,
          isDuplex = isDuplex,
          pageSizeName = pageSizeName,
          totalPages = targetPages.size
        )
        outputStream.write(header)

        encodeBitmapScanlines(bitmap, pageIsColor, outputStream)

        bitmap.recycle()
      }
    } finally {
      renderer.close()
      pfd.close()
    }
  }

  private fun encodeBitmapScanlines(
    bitmap: Bitmap,
    isColor: Boolean,
    out: OutputStream
  ) {
    val width = bitmap.width
    val height = bitmap.height

    val currentPixels = IntArray(width)
    val nextPixels = IntArray(width)
    val lineBuffer = FastLineBuffer(width * (if (isColor) 3 else 1) + 256)

    var y = 0
    bitmap.getPixels(currentPixels, 0, width, 0, y, width, 1)

    while (y < height) {
      var repeatCount = 1
      while (y + repeatCount < height && repeatCount < 256) {
        bitmap.getPixels(nextPixels, 0, width, 0, y + repeatCount, width, 1)
        if (areRowsEqual(currentPixels, nextPixels, isColor)) {
          repeatCount++
        } else {
          break
        }
      }

      // Write line repeat count byte (count - 1)
      out.write((repeatCount - 1) and 0xFF)

      // Compress current line using PackBits
      lineBuffer.reset()
      encodePackBits(currentPixels, isColor, lineBuffer)
      lineBuffer.writeTo(out)

      y += repeatCount
      if (y < height) {
        if (repeatCount < 256) {
          // nextPixels already contains the row that broke the repeat check
          System.arraycopy(nextPixels, 0, currentPixels, 0, width)
        } else {
          // repeatCount reached max 256, fetch the new row explicitly
          bitmap.getPixels(currentPixels, 0, width, 0, y, width, 1)
        }
      }
    }
  }

  private fun areRowsEqual(row1: IntArray, row2: IntArray, isColor: Boolean): Boolean {
    if (isColor) {
      for (i in row1.indices) {
        if ((row1[i] and 0x00FFFFFF) != (row2[i] and 0x00FFFFFF)) return false
      }
    } else {
      for (i in row1.indices) {
        val p1 = row1[i]
        val g1 = (299 * ((p1 shr 16) and 0xFF) + 587 * ((p1 shr 8) and 0xFF) + 114 * (p1 and 0xFF) + 500) / 1000
        val p2 = row2[i]
        val g2 = (299 * ((p2 shr 16) and 0xFF) + 587 * ((p2 shr 8) and 0xFF) + 114 * (p2 and 0xFF) + 500) / 1000
        if (g1 != g2) return false
      }
    }
    return true
  }

  /**
   * Encodes scanline using the standard CUPS/PWG PackBits compression.
   * Matches lines 1823-1873 of CUPS raster-stream.c.
   */
  private fun encodePackBits(
    pixels: IntArray,
    isColor: Boolean,
    out: FastLineBuffer
  ) {
    val width = pixels.size
    var ptr = 0

    while (ptr < width) {
      val start = ptr
      val p0 = pixels[ptr]
      ptr++

      if (ptr >= width) {
        // Single pixel at the end of scanline
        out.write(0)
        writePixel(p0, isColor, out)
      } else if (isPixelEqual(p0, pixels[ptr], isColor)) {
        // Sequence of repeating pixels (2 to 128)
        var count = 2
        ptr++
        while (count < 128 && ptr < width) {
          if (!isPixelEqual(pixels[ptr - 1], pixels[ptr], isColor)) break
          count++
          ptr++
        }
        out.write((count - 1) and 0xFF)
        writePixel(p0, isColor, out)
      } else {
        // Sequence of non-repeating (literal) pixels (1 to 128)
        var count = 1
        while (count < 128 && ptr < width) {
          if (ptr + 1 < width && isPixelEqual(pixels[ptr], pixels[ptr + 1], isColor)) break
          count++
          ptr++
        }
        out.write((257 - count) and 0xFF)
        for (k in start until (start + count)) {
          writePixel(pixels[k], isColor, out)
        }
      }
    }
  }

  private inline fun writePixel(pixel: Int, isColor: Boolean, out: FastLineBuffer) {
    val r = (pixel shr 16) and 0xFF
    val g = (pixel shr 8) and 0xFF
    val b = pixel and 0xFF
    if (isColor) {
      out.write(r)
      out.write(g)
      out.write(b)
    } else {
      // 8-bit native monochrome (sGray) - 1 byte per pixel!
      // Fires all 180 black nozzles on Epson inkjets (~16 scrolls instead of 34)
      val gray = (299 * r + 587 * g + 114 * b + 500) / 1000
      out.write(gray)
    }
  }

  /**
   * Fast detection of color pixels in a rendered bitmap.
   * Checks every 4th scanline for non-grayscale pixels (|R-G| > 6 or |R-B| > 6).
   */
  fun hasColorPixels(bitmap: Bitmap): Boolean {
    val width = bitmap.width
    val height = bitmap.height
    val row = IntArray(width)
    for (y in 0 until height step 4) {
      bitmap.getPixels(row, 0, width, 0, y, width, 1)
      for (pixel in row) {
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        if (Math.abs(r - g) > 6 || Math.abs(r - b) > 6 || Math.abs(g - b) > 6) {
          return true
        }
      }
    }
    return false
  }

  private inline fun isPixelEqual(p1: Int, p2: Int, isColor: Boolean): Boolean {
    return if (isColor) {
      (p1 and 0x00FFFFFF) == (p2 and 0x00FFFFFF)
    } else {
      val g1 = (299 * ((p1 shr 16) and 0xFF) + 587 * ((p1 shr 8) and 0xFF) + 114 * (p1 and 0xFF) + 500) / 1000
      val g2 = (299 * ((p2 shr 16) and 0xFF) + 587 * ((p2 shr 8) and 0xFF) + 114 * (p2 and 0xFF) + 500) / 1000
      g1 == g2
    }
  }

  private class FastLineBuffer(capacity: Int) {
    private var buf = ByteArray(capacity)
    private var count = 0

    fun reset() {
      count = 0
    }

    fun write(b: Int) {
      if (count >= buf.size) {
        val newBuf = ByteArray(Math.max(buf.size * 2, count + 1))
        System.arraycopy(buf, 0, newBuf, 0, count)
        buf = newBuf
      }
      buf[count++] = b.toByte()
    }

    fun writeTo(out: OutputStream) {
      if (count > 0) {
        out.write(buf, 0, count)
      }
    }
  }
}

