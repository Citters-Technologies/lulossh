package com.lulossh.ssh

import android.os.Build
import androidx.biometric.BiometricManager.Authenticators
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Muestra el diálogo de huella/PIN. Al aceptar, el Keystore permite usar la
 * clave del vault durante KeyVault.AUTH_WINDOW_S segundos.
 */
object BiometricUnlock {
    fun prompt(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        onResult: (ok: Boolean, error: String?) -> Unit,
    ) {
        val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Authenticators.BIOMETRIC_STRONG or Authenticators.DEVICE_CREDENTIAL
        } else {
            Authenticators.BIOMETRIC_WEAK or Authenticators.DEVICE_CREDENTIAL
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(authenticators)
            .build()

        val prompt = BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) =
                    onResult(true, null)

                override fun onAuthenticationError(code: Int, msg: CharSequence) =
                    onResult(false, msg.toString())
                // onAuthenticationFailed: intento fallido, el diálogo sigue abierto.
            },
        )
        prompt.authenticate(info)
    }
}
