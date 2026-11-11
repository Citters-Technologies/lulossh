package com.lulossh.ssh

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.UserNotAuthenticatedException
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** El usuario no se ha autenticado recientemente: hay que llamar a unlock(). */
class VaultLockedException(cause: Throwable) : Exception("Vault bloqueado", cause)

/**
 * Almacén cifrado. Una clave AES-256-GCM vive en el Android Keystore (no
 * exportable) y solo se puede usar durante AUTH_WINDOW_S segundos después de
 * autenticarse con biometría o con el PIN/patrón del dispositivo.
 * En disco (SharedPreferences privadas) solo hay IV + texto cifrado.
 */
class KeyVault(context: Context) {
    private val prefs = context.getSharedPreferences("lulossh_vault", Context.MODE_PRIVATE)
    private val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    private fun secretKey(): SecretKey {
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(
            ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(
                AUTH_WINDOW_S,
                KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        } else {
            @Suppress("DEPRECATION")
            spec.setUserAuthenticationValidityDurationSeconds(AUTH_WINDOW_S)
        }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        try {
            gen.init(spec.build())
            return gen.generateKey()
        } catch (e: IllegalStateException) {
            // Sin bloqueo de pantalla no se pueden crear claves con autenticación.
            throw IllegalStateException("Configura un bloqueo de pantalla (PIN, patrón o huella)", e)
        }
    }

    private inline fun <T> guarded(block: () -> T): T = try {
        block()
    } catch (e: UserNotAuthenticatedException) {
        throw VaultLockedException(e)
    }

    fun put(name: String, value: String) = guarded {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val blob = cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        prefs.edit().putString(name, Base64.encodeToString(blob, Base64.NO_WRAP)).apply()
    }

    fun get(name: String): String? = guarded {
        val blob = prefs.getString(name, null)?.let { Base64.decode(it, Base64.NO_WRAP) }
            ?: return@guarded null
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, blob, 0, IV_LEN))
        String(cipher.doFinal(blob, IV_LEN, blob.size - IV_LEN), Charsets.UTF_8)
    }

    fun delete(name: String) {
        prefs.edit().remove(name).apply()
    }

    companion object {
        const val AUTH_WINDOW_S = 300
        private const val ALIAS = "lulossh_vault_v2"
        private const val TRANSFORM = "AES/GCM/NoPadding"
        private const val IV_LEN = 12

        fun privateKeyName(id: String) = "key:$id"
        fun passphraseName(id: String) = "keypass:$id"
        fun valueName(name: String) = "kv:$name"
    }
}
