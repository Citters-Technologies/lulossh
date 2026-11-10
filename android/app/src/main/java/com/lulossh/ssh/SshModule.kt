package com.lulossh.ssh

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.connection.channel.direct.Session
import net.schmizz.sshj.transport.verification.HostKeyVerifier
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Implementa el contrato de src/native/SshModule.ts. */
class SshModule(private val rc: ReactApplicationContext) : ReactContextBaseJavaModule(rc) {

    private class Sess(val client: SSHClient, val shell: Session.Shell, val session: Session)

    private val sessions = ConcurrentHashMap<String, Sess>()
    private val pendingHostKeys = ConcurrentHashMap<String, CompletableFuture<Boolean>>()
    private val pool = Executors.newCachedThreadPool()
    private val vault by lazy { KeyVault(rc) }

    override fun getName() = "LuloSsh"

    init {
        // Android trae una versión recortada de BouncyCastle: usamos la completa.
        java.security.Security.removeProvider("BC")
        java.security.Security.insertProviderAt(org.bouncycastle.jce.provider.BouncyCastleProvider(), 1)
    }

    private fun emit(event: String, map: WritableMap) {
        rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit(event, map)
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    @ReactMethod
    fun importKey(keyId: String, pem: String, promise: Promise) {
        try {
            vault.save(keyId, pem)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("KEY_ERROR", e)
        }
    }

    @ReactMethod
    fun deleteKey(keyId: String, promise: Promise) {
        vault.delete(keyId)
        promise.resolve(null)
    }

    @ReactMethod
    fun connect(opts: ReadableMap, promise: Promise) {
        pool.execute {
            val id = UUID.randomUUID().toString()
            try {
                val client = SSHClient()
                val known = if (opts.hasKey("knownHostFingerprint")) opts.getString("knownHostFingerprint") else null
                client.addHostKeyVerifier(object : HostKeyVerifier {
                    override fun verify(h: String, p: Int, key: PublicKey): Boolean {
                        val fp = SecurityUtils.getFingerprint(key)
                        if (known != null && known == fp) return true
                        val fut = CompletableFuture<Boolean>()
                        pendingHostKeys[id] = fut
                        emit("hostKey", Arguments.createMap().apply {
                            putString("sessionId", id)
                            putString("fingerprint", fp)
                            putBoolean("changed", known != null)
                        })
                        return try { fut.get(120, TimeUnit.SECONDS) } catch (e: Exception) { false }
                    }
                    override fun findExistingAlgorithms(h: String, p: Int) = emptyList<String>()
                })
                client.connect(opts.getString("host"), opts.getInt("port"))

                val user = opts.getString("username")!!
                val auth = opts.getMap("auth")!!
                when (auth.getString("type")) {
                    "password" -> client.authPassword(user, auth.getString("password"))
                    "privateKey" -> {
                        val pem = vault.load(auth.getString("keyId")!!)
                            ?: throw IllegalStateException("Clave no encontrada")
                        val pass = if (auth.hasKey("passphrase")) auth.getString("passphrase") else null
                        val kp = if (pass.isNullOrEmpty()) client.loadKeys(pem, null, null)
                        else client.loadKeys(pem, null, net.schmizz.sshj.userauth.password.PasswordUtils.createOneOff(pass.toCharArray()))
                        client.authPublickey(user, kp)
                    }
                    else -> throw IllegalArgumentException("Método de auth desconocido")
                }

                val session = client.startSession()
                val term = if (opts.hasKey("term")) opts.getString("term")!! else "xterm-256color"
                session.allocatePTY(term, opts.getInt("cols"), opts.getInt("rows"), 0, 0, emptyMap())
                val shell = session.startShell()
                sessions[id] = Sess(client, shell, session)
                pump(id, shell)
                promise.resolve(id)
            } catch (e: Exception) {
                promise.reject("CONNECT_ERROR", e.message, e)
            }
        }
    }

    private fun pump(id: String, shell: Session.Shell) {
        pool.execute {
            val buf = ByteArray(8192)
            try {
                val input = shell.inputStream
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    emit("data", Arguments.createMap().apply {
                        putString("sessionId", id)
                        putString("base64", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP))
                    })
                }
                emit("closed", Arguments.createMap().apply { putString("sessionId", id) })
            } catch (e: Exception) {
                emit("closed", Arguments.createMap().apply {
                    putString("sessionId", id); putString("reason", e.message)
                })
            } finally {
                closeSession(id)
            }
        }
    }

    @ReactMethod
    fun write(id: String, base64: String, promise: Promise) {
        val s = sessions[id] ?: return promise.reject("NO_SESSION", "Sesión inexistente")
        pool.execute {
            try {
                s.shell.outputStream.apply { write(Base64.decode(base64, Base64.NO_WRAP)); flush() }
                promise.resolve(null)
            } catch (e: Exception) { promise.reject("WRITE_ERROR", e) }
        }
    }

    @ReactMethod
    fun resize(id: String, cols: Int, rows: Int, promise: Promise) {
        val s = sessions[id] ?: return promise.reject("NO_SESSION", "Sesión inexistente")
        pool.execute {
            try { s.shell.changeWindowDimensions(cols, rows, 0, 0); promise.resolve(null) }
            catch (e: Exception) { promise.reject("RESIZE_ERROR", e) }
        }
    }

    @ReactMethod
    fun acceptHostKey(id: String, accept: Boolean, promise: Promise) {
        pendingHostKeys.remove(id)?.complete(accept)
        promise.resolve(null)
    }

    @ReactMethod
    fun disconnect(id: String, promise: Promise) {
        closeSession(id)
        promise.resolve(null)
    }

    private fun closeSession(id: String) {
        sessions.remove(id)?.let {
            try { it.session.close() } catch (_: Exception) {}
            try { it.client.disconnect() } catch (_: Exception) {}
        }
    }
}
