package com.lulossh.ssh

import android.util.Base64
import java.security.MessageDigest

/**
 * Descifra las contraseñas que Xshell guarda en el campo `Password=` de cada
 * sesión (.xsh). Es dato del propio usuario: migración de su gestor SSH.
 *
 * Esquema de Xshell/Xmanager >= 5.1 (confirmado por ingeniería inversa pública):
 *   - clave = SHA-256(material)              material = contraseña maestra (si
 *                                            el export tiene Master=1) o, en
 *                                            Windows, usuario+SID (no portable).
 *   - cuerpo = RC4(clave) sobre blob[:-32]
 *   - blob[-32:] = SHA-256(texto_plano)      sello de verificación.
 *
 * El sello hace esto SEGURO: si la contraseña maestra o el algoritmo no
 * encajan (p. ej. una versión de Xshell con otro esquema), el sello no cuadra
 * y devolvemos null en lugar de una contraseña corrupta. Nunca se acepta una
 * contraseña cuyo SHA-256 no coincida.
 */
object XshellCrypto {

    private fun sha256(b: ByteArray): ByteArray =
        MessageDigest.getInstance("SHA-256").digest(b)

    /** RC4/ARCFOUR. Implementado a mano para no depender del proveedor JCE. */
    private fun rc4(key: ByteArray, data: ByteArray): ByteArray {
        val s = IntArray(256) { it }
        var j = 0
        for (i in 0 until 256) {
            j = (j + s[i] + (key[i % key.size].toInt() and 0xff)) and 0xff
            val t = s[i]; s[i] = s[j]; s[j] = t
        }
        val out = ByteArray(data.size)
        var a = 0; var b = 0
        for (k in data.indices) {
            a = (a + 1) and 0xff
            b = (b + s[a]) and 0xff
            val t = s[a]; s[a] = s[b]; s[b] = t
            out[k] = (data[k].toInt() xor s[(s[a] + s[b]) and 0xff]).toByte()
        }
        return out
    }

    /**
     * Intenta descifrar un blob base64 con las claves candidatas (derivadas de
     * la contraseña maestra con distintas codificaciones). Devuelve el texto
     * plano solo si su SHA-256 coincide con el sello; null en cualquier otro
     * caso (contraseña incorrecta, formato distinto, blob vacío…).
     */
    fun decrypt(blobB64: String, keys: List<ByteArray>): String? {
        val blob = try {
            Base64.decode(blobB64.trim(), Base64.DEFAULT)
        } catch (_: Exception) {
            return null
        }
        if (blob.size <= 32) return null
        val body = blob.copyOfRange(0, blob.size - 32)
        val tag = blob.copyOfRange(blob.size - 32, blob.size)
        for (key in keys) {
            val plain = rc4(key, body)
            if (MessageDigest.isEqual(sha256(plain), tag)) {
                return String(plain, Charsets.UTF_8)
            }
        }
        return null
    }

    /** Claves candidatas a partir de la contraseña maestra (ascii/utf-8 y utf-16le). */
    fun keysFromMaster(master: String): List<ByteArray> =
        listOf(
            sha256(master.toByteArray(Charsets.UTF_8)),
            sha256(master.toByteArray(Charsets.UTF_16LE)),
        )
}
