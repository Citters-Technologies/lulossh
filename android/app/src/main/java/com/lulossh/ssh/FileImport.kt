package com.lulossh.ssh

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import java.io.ByteArrayInputStream
import java.nio.charset.Charset
import java.util.zip.ZipInputStream

/**
 * Selector de ficheros para importar (sesiones de Xshell, claves…).
 * Devuelve [{path, text}]: los zip (.xts/.zip) se expanden con sus carpetas,
 * que luego se usan como grupos. El análisis de formatos se hace en JS.
 */
class FileImport(private val rc: ReactApplicationContext) {

    private var pending: Promise? = null

    private val listener = object : BaseActivityEventListener() {
        override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
            if (requestCode != REQUEST) return
            val promise = pending ?: return
            pending = null
            if (resultCode != Activity.RESULT_OK || data == null) {
                promise.resolve(Arguments.createArray()) // cancelado
                return
            }
            val uris = mutableListOf<Uri>()
            data.clipData?.let { c -> for (i in 0 until c.itemCount) uris += c.getItemAt(i).uri }
            if (uris.isEmpty()) data.data?.let { uris += it }
            Thread {
                try {
                    promise.resolve(readAll(uris))
                } catch (e: Exception) {
                    promise.reject("IMPORT_ERROR", e.message, e)
                }
            }.start()
        }
    }

    init {
        rc.addActivityEventListener(listener)
    }

    fun pick(promise: Promise) {
        val activity = rc.currentActivity
            ?: return promise.reject("NO_ACTIVITY", "No hay actividad en primer plano")
        pending?.resolve(Arguments.createArray())
        pending = promise
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
        }
        activity.startActivityForResult(intent, REQUEST)
    }

    private fun readAll(uris: List<Uri>): WritableArray {
        val out = Arguments.createArray()
        var total = 0L
        var count = 0
        fun add(path: String, bytes: ByteArray) {
            if (bytes.size > MAX_FILE) return
            total += bytes.size
            if (total > MAX_TOTAL || ++count > MAX_ENTRIES) throw IllegalStateException("Importación demasiado grande")
            out.pushMap(Arguments.createMap().apply {
                putString("path", path)
                putString("text", decode(bytes))
            })
        }
        for (uri in uris) {
            val name = displayName(uri)
            val bytes = rc.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: continue
            if (bytes.size >= 4 && bytes[0] == 'P'.code.toByte() && bytes[1] == 'K'.code.toByte()) {
                unzip(bytes) { path, data -> add(path, data) }
            } else {
                add(name, bytes)
            }
        }
        return out
    }

    /** Los nombres dentro del zip pueden venir en UTF-8 o en la página de códigos de Windows. */
    private fun unzip(bytes: ByteArray, onEntry: (String, ByteArray) -> Unit) {
        for (cs in listOf(Charsets.UTF_8, Charset.forName("windows-1252"))) {
            val entries = mutableListOf<Pair<String, ByteArray>>()
            try {
                ZipInputStream(ByteArrayInputStream(bytes), cs).use { zip ->
                    while (true) {
                        val e = zip.nextEntry ?: break
                        if (!e.isDirectory) entries += e.name.replace('\\', '/') to readLimited(zip)
                    }
                }
            } catch (e: IllegalArgumentException) {
                continue // nombre mal codificado: probar con la siguiente codificación
            }
            entries.forEach { (p, d) -> onEntry(p, d) }
            return
        }
        throw IllegalStateException("No se pudo leer el zip")
    }

    private fun readLimited(zip: ZipInputStream): ByteArray {
        val buf = java.io.ByteArrayOutputStream()
        val chunk = ByteArray(8192)
        while (true) {
            val n = zip.read(chunk)
            if (n < 0) break
            buf.write(chunk, 0, n)
            if (buf.size() > MAX_FILE) return ByteArray(MAX_FILE + 1) // se descarta en add()
        }
        return buf.toByteArray()
    }

    private fun displayName(uri: Uri): String {
        rc.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0)?.let { return it }
        }
        return uri.lastPathSegment ?: "fichero"
    }

    companion object {
        private const val REQUEST = 4711
        private const val MAX_FILE = 1 shl 20 // 1 MB por fichero
        private const val MAX_TOTAL = 20L shl 20
        private const val MAX_ENTRIES = 5000

        /** Xshell guarda los .xsh en UTF-16LE; otros ficheros suelen ser UTF-8. */
        fun decode(b: ByteArray): String {
            if (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte())
                return String(b, 2, b.size - 2, Charsets.UTF_16LE)
            if (b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte())
                return String(b, 2, b.size - 2, Charsets.UTF_16BE)
            if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte())
                return String(b, 3, b.size - 3, Charsets.UTF_8)
            // UTF-16LE sin BOM: muchos ceros en posiciones impares.
            val sample = minOf(b.size, 200)
            var zeros = 0
            for (i in 1 until sample step 2) if (b[i] == 0.toByte()) zeros++
            if (sample > 10 && zeros > sample / 4) return String(b, Charsets.UTF_16LE)
            val utf8 = String(b, Charsets.UTF_8)
            return if (utf8.contains('�')) String(b, Charset.forName("windows-1252")) else utf8
        }
    }
}
