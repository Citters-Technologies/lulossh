package com.lulossh.ssh

import android.util.Base64
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.userauth.keyprovider.KeyProvider
import net.schmizz.sshj.userauth.password.PasswordUtils
import net.schmizz.sshj.SSHClient
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.util.OpenSSHPrivateKeyUtil
import org.bouncycastle.crypto.util.OpenSSHPublicKeyUtil
import java.security.PublicKey
import java.security.SecureRandom

object KeyTools {

    /**
     * Autenticación por contraseña probando "password" y, si el servidor no lo
     * permite, "keyboard-interactive" (por defecto en muchos sshd modernos).
     * Responde con la contraseña a cualquier pregunta sin eco, sea cual sea el
     * texto del prompt ("Password:", "Contraseña:", "Password for x@y:"…).
     */
    fun authPasswordOrInteractive(client: SSHClient, user: String, password: String) {
        val finder = object : net.schmizz.sshj.userauth.password.PasswordFinder {
            override fun reqPassword(resource: net.schmizz.sshj.userauth.password.Resource<*>?) =
                password.toCharArray()
            override fun shouldRetry(resource: net.schmizz.sshj.userauth.password.Resource<*>?) = false
        }
        val interactive = object : net.schmizz.sshj.userauth.method.ChallengeResponseProvider {
            override fun getSubmethods(): List<String> = emptyList()
            override fun init(resource: net.schmizz.sshj.userauth.password.Resource<*>?, name: String?, instruction: String?) {}
            override fun getResponse(prompt: String?, echo: Boolean): CharArray =
                if (echo) CharArray(0) else password.toCharArray()
            override fun shouldRetry() = false
        }
        client.auth(
            user,
            net.schmizz.sshj.userauth.method.AuthPassword(finder),
            net.schmizz.sshj.userauth.method.AuthKeyboardInteractive(interactive),
        )
    }

    data class Generated(val privatePem: String, val publicKey: String)

    /** Genera un par ed25519 en formato OpenSSH (sin cifrar: lo cifra el vault). */
    fun generateEd25519(comment: String): Generated {
        val gen = Ed25519KeyPairGenerator()
        gen.init(Ed25519KeyGenerationParameters(SecureRandom()))
        val kp = gen.generateKeyPair()
        val priv = kp.private as Ed25519PrivateKeyParameters
        val pub = kp.public as Ed25519PublicKeyParameters

        val privBlob = OpenSSHPrivateKeyUtil.encodePrivateKey(priv)
        val pem = buildString {
            append("-----BEGIN OPENSSH PRIVATE KEY-----\n")
            Base64.encodeToString(privBlob, Base64.NO_WRAP).chunked(70).forEach { append(it).append('\n') }
            append("-----END OPENSSH PRIVATE KEY-----\n")
        }
        val pubB64 = Base64.encodeToString(OpenSSHPublicKeyUtil.encodePublicKey(pub), Base64.NO_WRAP)
        return Generated(pem, "ssh-ed25519 $pubB64 $comment".trim())
    }

    /** Carga una clave con sshj (valida formato y passphrase). */
    fun load(pem: String, passphrase: String?): KeyProvider {
        val client = SSHClient()
        return if (passphrase.isNullOrEmpty()) {
            client.loadKeys(pem, null, null)
        } else {
            client.loadKeys(pem, null, PasswordUtils.createOneOff(passphrase.toCharArray()))
        }
    }

    /** Línea authorized_keys: "<tipo> <base64> <comentario>". */
    fun publicKeyLine(key: PublicKey, comment: String): String {
        val type = KeyType.fromKey(key).toString()
        val blob = Buffer.PlainBuffer().putPublicKey(key).compactData
        return "$type ${Base64.encodeToString(blob, Base64.NO_WRAP)} $comment".trim()
    }
}
