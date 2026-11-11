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
    // Proyecciones y orden tal cual PluginContract (el provider espera columnas explícitas).
    private val CONNECTIONS = arrayOf(
        "id", "rowid AS _id", "modified",
        "COALESCE(NULLIF(nickname,''), address) AS name",
        "address", "port", "nickname", "type",
    )
    private val GROUPS = arrayOf("id", "rowid AS _id", "modified", "name")
    private val MEMBERSHIPS = arrayOf("id", "rowid AS _id", "modified", "group_id", "connection_id")

    fun read(ctx: Context): WritableMap = Arguments.createMap().apply {
        putArray("connections", query(ctx, "connections", CONNECTIONS, "name COLLATE NOCASE ASC",
            listOf("id", "name", "nickname", "address", "port", "type")))
        putArray("groups", tryQuery(ctx, "connectiongroups", GROUPS, "name COLLATE NOCASE ASC", listOf("id", "name")))
        putArray("memberships", tryQuery(ctx, "connectiongroupmemberships", MEMBERSHIPS, "id ASC",
            listOf("group_id", "connection_id")))
    }

    // Los grupos son opcionales: si fallan, se importan las conexiones sin carpeta.
    private fun tryQuery(ctx: Context, path: String, proj: Array<String>, sort: String, cols: List<String>): WritableArray =
        try {
            query(ctx, path, proj, sort, cols)
        } catch (e: Exception) {
            android.util.Log.w("LuloSSH", "JuiceSSH $path: ${e.message}", e)
            Arguments.createArray()
        }

    private fun query(ctx: Context, path: String, proj: Array<String>, sort: String, cols: List<String>): WritableArray {
        val out = Arguments.createArray()
        val cursor = ctx.contentResolver.query(Uri.parse("$AUTHORITY/$path"), proj, null, null, sort)
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
