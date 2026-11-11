package com.lulossh.ssh

import android.content.Context
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * Lectura de JuiceSSH a través de su API pública de plugins (ContentProvider
 * "com.sonelli.juicessh.api.v1", ver PluginContract de juicessh-pluginlibrary,
 * Apache-2.0). Solo expone conexiones y grupos: ni usuarios, ni contraseñas,
 * ni claves (las "identidades" no están en la API).
 */
object JuiceImport {
    const val PACKAGE = "com.sonelli.juicessh"
    private const val AUTHORITY = "content://com.sonelli.juicessh.api.v1"

    fun isInstalled(ctx: Context): Boolean = try {
        ctx.packageManager.getPackageInfo(PACKAGE, 0)
        true
    } catch (_: Exception) {
        false
    }

    /** {connections, groups, memberships}; lanza SecurityException si falta permiso. */
    fun read(ctx: Context): WritableMap = Arguments.createMap().apply {
        putArray("connections", query(ctx, "connections", listOf("id", "name", "nickname", "address", "port", "type")))
        putArray("groups", tryQuery(ctx, "connectiongroups", listOf("id", "name")))
        putArray("memberships", tryQuery(ctx, "connectiongroupmemberships", listOf("group_id", "connection_id")))
    }

    // Los grupos son opcionales: si fallan, se importan las conexiones sin carpeta.
    private fun tryQuery(ctx: Context, path: String, cols: List<String>): WritableArray =
        try { query(ctx, path, cols) } catch (_: SecurityException) { Arguments.createArray() }

    private fun query(ctx: Context, path: String, cols: List<String>): WritableArray {
        val out = Arguments.createArray()
        val cursor = ctx.contentResolver.query(Uri.parse("$AUTHORITY/$path"), null, null, null, null)
            ?: throw IllegalStateException("JuiceSSH no respondió ($path)")
        cursor.use { c ->
            while (c.moveToNext()) {
                val row = Arguments.createMap()
                for (col in cols) {
                    val i = c.getColumnIndex(col)
                    if (i >= 0 && !c.isNull(i)) row.putString(col, c.getString(i))
                }
                out.pushMap(row)
            }
        }
        return out
    }
}
