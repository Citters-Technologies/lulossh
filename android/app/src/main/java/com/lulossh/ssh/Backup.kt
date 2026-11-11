package com.lulossh.ssh

import android.util.Base64
import org.bouncycastle.crypto.generators.SCrypt
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Copia de seguridad portable: no depende del Keystore del dispositivo (que
 * se pierde al desinstalar), sino de una contraseña elegida por el usuario.
 *
 * Formato (JSON):
 *   {"format":"lulossh-backup","v":1,
 *    "kdf":{"alg":"scrypt","N":32768,"r":8,"p":1,"salt":b64},
 *    "cipher":"AES-256-GCM","iv":b64,"data":b64}
 * La contraseña deriva la clave con scrypt; el contenido va cifrado y
 * autenticado con AES-GCM (una contraseña errónea falla al descifrar).
 */
object Backup {
    private const val FORMAT = "lulossh-backup"
    private const val N = 1 shl 15
    private const val R = 8
    private const val P = 1
    private val random = SecureRandom()

    private fun b64(b: ByteArray) = Base64.encodeToString(b, Base64.NO_WRAP)
    private fun unb64(s: String) = Base64.decode(s, Base64.NO_WRAP)

    private fun derive(pass: String, salt: ByteArray, n: Int, r: Int, p: Int): ByteArray =
        SCrypt.generate(pass.toByteArray(Charsets.UTF_8), salt, n, r, p, 32)

    fun encrypt(plain: String, pass: String): String {
        val salt = ByteArray(16).also(random::nextBytes)
        val iv = ByteArray(12).also(random::nextBytes)
        val key = derive(pass, salt, N, R, P)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        c.updateAAD(FORMAT.toByteArray())
        val ct = c.doFinal(plain.toByteArray(Charsets.UTF_8))
        key.fill(0)
        return JSONObject().apply {
            put("format", FORMAT)
            put("v", 1)
            put("kdf", JSONObject().apply {
                put("alg", "scrypt"); put("N", N); put("r", R); put("p", P); put("salt", b64(salt))
            })
            put("cipher", "AES-256-GCM")
            put("iv", b64(iv))
            put("data", b64(ct))
        }.toString()
    }

    class BadPassword : Exception("Contraseña incorrecta o copia dañada")

    fun decrypt(file: String, pass: String): String {
        val j = try { JSONObject(file) } catch (e: Exception) {
            throw IllegalArgumentException("No es una copia de seguridad de LuloSSH")
        }
        if (j.optString("format") != FORMAT) throw IllegalArgumentException("No es una copia de seguridad de LuloSSH")
        if (j.optInt("v") != 1) throw IllegalArgumentException("Versión de copia no soportada (actualiza LuloSSH)")
        val kdf = j.getJSONObject("kdf")
        val n = kdf.getInt("N"); val r = kdf.getInt("r"); val p = kdf.getInt("p")
        // Límites para que un fichero manipulado no agote memoria/CPU.
        require(n in 1024..(1 shl 20) && r in 1..16 && p in 1..4) { "Parámetros de copia no válidos" }
        val key = derive(pass, unb64(kdf.getString("salt")), n, r, p)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, unb64(j.getString("iv"))))
        c.updateAAD(FORMAT.toByteArray())
        return try {
            String(c.doFinal(unb64(j.getString("data"))), Charsets.UTF_8)
        } catch (e: javax.crypto.AEADBadTagException) {
            throw BadPassword()
        } finally {
            key.fill(0)
        }
    }
}
