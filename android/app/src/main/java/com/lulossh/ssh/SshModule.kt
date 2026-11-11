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

    private class Sess(
        val client: SSHClient,
        val shell: Session.Shell,
        val session: Session,
        val hostId: String?,
        val title: String,
        val startedAt: Long = System.currentTimeMillis(),
    ) {
        /** Últimos bytes de salida, para restaurar la pantalla al volver. */
        val history = ByteRing(HISTORY_BYTES)
    }

    /** Buffer circular de bytes (thread-safe). */
    private class ByteRing(private val cap: Int) {
        private val buf = ByteArray(cap)
        private var start = 0
        private var size = 0

        @Synchronized fun append(src: ByteArray, len: Int) {
            for (i in 0 until len) {
                buf[(start + size) % cap] = src[i]
                if (size < cap) size++ else start = (start + 1) % cap
            }
        }

        @Synchronized fun snapshot(): ByteArray =
            ByteArray(size) { buf[(start + it) % cap] }
    }

    /** Actualiza el servicio en primer plano (notificación) con las sesiones abiertas. */
    private fun syncService(lastId: String? = null) {
        val list = sessions.entries.sortedBy { it.value.startedAt }
        SshService.sync(rc, list.map { it.value.title }, lastId ?: list.lastOrNull()?.key)
    }

    @ReactMethod
    fun listSessions(promise: Promise) {
        val arr = Arguments.createArray()
        sessions.entries.sortedBy { it.value.startedAt }.forEach { (id, s) ->
            arr.pushMap(Arguments.createMap().apply {
                putString("sessionId", id)
                putString("hostId", s.hostId)
                putString("title", s.title)
                putDouble("startedAt", s.startedAt.toDouble())
            })
        }
        promise.resolve(arr)
    }

    /** Historial reciente (base64) para repintar una sesión que siguió en segundo plano. */
    @ReactMethod
    fun attach(id: String, promise: Promise) {
        val s = sessions[id] ?: return promise.reject("NO_SESSION", "La sesión ya no existe")
        promise.resolve(Base64.encodeToString(s.history.snapshot(), Base64.NO_WRAP))
    }

    /** Sesión pedida desde la notificación (una sola vez), o null. */
    @ReactMethod
    fun consumePendingOpen(promise: Promise) {
        val id = SshService.pendingOpen
        SshService.pendingOpen = null
        promise.resolve(id)
        // Por si Android no dejó arrancar el servicio en segundo plano.
        if (sessions.isNotEmpty()) syncService()
    }

    private val sessions = ConcurrentHashMap<String, Sess>()
    private val pendingHostKeys = ConcurrentHashMap<String, CompletableFuture<Boolean>>()
    private val connecting = ConcurrentHashMap<String, SSHClient>()
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

    private val uiPrefs by lazy { rc.getSharedPreferences("lulossh_ui", android.content.Context.MODE_PRIVATE) }

    @ReactMethod
    fun setVolumeKeysEnabled(enabled: Boolean) {
        VolumeKeys.attach(rc)
        VolumeKeys.enabled = enabled
    }

    /** Abre el teclado del sistema sobre la vista nativa de entrada (ver TerminalInput). */
    @ReactMethod
    fun showKeyboard() {
        val activity = rc.currentActivity ?: return
        activity.runOnUiThread {
            TerminalInput.show(activity) { data ->
                emit("termInput", Arguments.createMap().apply { putString("data", data) })
            }
        }
    }

    @ReactMethod
    fun hideKeyboard(detach: Boolean) {
        val activity = rc.currentActivity ?: return
        activity.runOnUiThread {
            TerminalInput.hide(activity)
            if (detach) TerminalInput.detach()
        }
    }

    /** Preferencias de interfaz NO sensibles (tamaño de letra…), sin cifrar. */
    @ReactMethod
    fun prefGet(name: String, promise: Promise) = promise.resolve(uiPrefs.getString(name, null))

    @ReactMethod
    fun prefSet(name: String, value: String, promise: Promise) {
        uiPrefs.edit().putString(name, value).apply()
        promise.resolve(null)
    }

    private val clipboard by lazy {
        rc.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
    }

    @ReactMethod
    fun copyText(text: String) {
        rc.runOnUiQueueThread {
            clipboard.setPrimaryClip(android.content.ClipData.newPlainText("LuloSSH", text))
        }
    }

    @ReactMethod
    fun pasteText(promise: Promise) {
        rc.runOnUiQueueThread {
            try {
                val item = clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)
                promise.resolve(item?.coerceToText(rc)?.toString())
            } catch (e: Exception) {
                promise.reject("CLIPBOARD_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun isJuiceSshInstalled(promise: Promise) = promise.resolve(JuiceImport.isInstalled(rc))

    /** Conexiones y grupos de JuiceSSH (requiere sus permisos READ_*). */
    @ReactMethod
    fun readJuiceSsh(promise: Promise) {
        pool.execute {
            try {
                promise.resolve(JuiceImport.read(rc))
            } catch (e: SecurityException) {
                promise.reject("NO_PERMISSION", "JuiceSSH no ha dado permiso para leer sus conexiones", e)
            } catch (e: Exception) {
                promise.reject("JUICE_ERROR", e.message, e)
            }
        }
    }

    private val fileImport by lazy { FileImport(rc) }

    /** Selector de ficheros para importar; resuelve con [{path, text}] ([] si se cancela). */
    @ReactMethod
    fun pickImportFiles(promise: Promise) {
        val activity = rc.currentActivity
            ?: return promise.reject("NO_ACTIVITY", "No hay actividad en primer plano")
        activity.runOnUiThread { fileImport.pick(promise) }
    }

    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    /** Ejecuta en background; VaultLockedException -> código "LOCKED" para que JS pida unlock(). */
    private fun vaultCall(promise: Promise, block: () -> Any?) {
        pool.execute {
            try {
                promise.resolve(block())
            } catch (e: VaultLockedException) {
                promise.reject("LOCKED", "Vault bloqueado", e)
            } catch (e: Exception) {
                promise.reject("VAULT_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun unlock(reason: String, promise: Promise) {
        val activity = rc.currentActivity as? androidx.fragment.app.FragmentActivity
            ?: return promise.reject("NO_ACTIVITY", "No hay actividad en primer plano")
        activity.runOnUiThread {
            BiometricUnlock.prompt(activity, "Desbloquear LuloSSH", reason) { ok, err ->
                if (ok) promise.resolve(null) else promise.reject("UNLOCK_FAILED", err ?: "Cancelado")
            }
        }
    }

    @ReactMethod
    fun secureGet(name: String, promise: Promise) =
        vaultCall(promise) { vault.get(KeyVault.valueName(name)) }

    @ReactMethod
    fun secureSet(name: String, value: String, promise: Promise) =
        vaultCall(promise) { vault.put(KeyVault.valueName(name), value); null }

    @ReactMethod
    fun secureDelete(name: String, promise: Promise) =
        vaultCall(promise) { vault.delete(KeyVault.valueName(name)); null }

    @ReactMethod
    fun generateKey(keyId: String, comment: String, promise: Promise) = vaultCall(promise) {
        val g = KeyTools.generateEd25519(comment)
        vault.put(KeyVault.privateKeyName(keyId), g.privatePem)
        Arguments.createMap().apply {
            putString("type", "ssh-ed25519")
            putString("publicKey", g.publicKey)
        }
    }

    /** Valida la clave (y la passphrase) antes de guardarla; devuelve la pública. */
    @ReactMethod
    fun importKey(keyId: String, pem: String, passphrase: String?, comment: String, promise: Promise) =
        vaultCall(promise) {
            val kp = try {
                KeyTools.load(pem, passphrase)
            } catch (e: Exception) {
                throw IllegalArgumentException("Clave no válida o passphrase incorrecta", e)
            }
            val pub = kp.public
            vault.put(KeyVault.privateKeyName(keyId), pem)
            if (!passphrase.isNullOrEmpty()) vault.put(KeyVault.passphraseName(keyId), passphrase)
            Arguments.createMap().apply {
                putString("type", net.schmizz.sshj.common.KeyType.fromKey(pub).toString())
                putString("publicKey", KeyTools.publicKeyLine(pub, comment))
            }
        }

    @ReactMethod
    fun deleteKey(keyId: String, promise: Promise) = vaultCall(promise) {
        vault.delete(KeyVault.privateKeyName(keyId))
        vault.delete(KeyVault.passphraseName(keyId))
        null
    }

    /**
     * El sessionId lo genera JS y llega en opts, para que JS pueda atender los
     * eventos (p. ej. hostKey) mientras connect() aún no ha resuelto.
     */
    @ReactMethod
    fun connect(opts: ReadableMap, promise: Promise) {
        pool.execute {
            val id = if (opts.hasKey("sessionId")) opts.getString("sessionId")!! else UUID.randomUUID().toString()
            val host = opts.getString("host")!!
            val port = opts.getInt("port")
            // Keepalive SSH: detecta conexiones muertas (wifi caído, NAT que expira…).
            val client = SSHClient(net.schmizz.sshj.DefaultConfig().apply {
                keepAliveProvider = net.schmizz.keepalive.KeepAliveProvider.KEEP_ALIVE
            })
            connecting[id] = client
            try {
                client.connectTimeout = CONNECT_TIMEOUT_MS
                // El kex espera mientras el usuario lee la huella: margen amplio.
                client.transport.timeoutMs = HOSTKEY_WAIT_MS + 10_000
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
                        return try {
                            fut.get(HOSTKEY_WAIT_MS.toLong(), TimeUnit.MILLISECONDS)
                        } catch (e: Exception) {
                            false
                        } finally {
                            pendingHostKeys.remove(id)
                        }
                    }
                    override fun findExistingAlgorithms(h: String, p: Int) = emptyList<String>()
                })
                try {
                    client.connect(host, port)
                } catch (e: java.net.SocketTimeoutException) {
                    throw ConnectFailure("No responde $host:$port (timeout). ¿Está el móvil en la misma red o VPN que el servidor?", e)
                } catch (e: java.net.UnknownHostException) {
                    throw ConnectFailure("No se encuentra el host \"$host\" (DNS)", e)
                } catch (e: java.net.ConnectException) {
                    throw ConnectFailure("Conexión rechazada en $host:$port. ¿Puerto correcto y sshd activo?", e)
                } catch (e: net.schmizz.sshj.transport.TransportException) {
                    if (e.disconnectReason == net.schmizz.sshj.common.DisconnectReason.HOST_KEY_NOT_VERIFIABLE) {
                        throw ConnectFailure("Huella del servidor no aceptada", e)
                    }
                    throw e
                }

                val user = opts.getString("username")!!
                val auth = opts.getMap("auth")!!
                try { when (auth.getString("type")) {
                    "password" -> KeyTools.authPasswordOrInteractive(client, user, auth.getString("password") ?: "")
                    "privateKey" -> {
                        val keyId = auth.getString("keyId")!!
                        val pem = vault.get(KeyVault.privateKeyName(keyId))
                            ?: throw IllegalStateException("Clave no encontrada")
                        val pass = vault.get(KeyVault.passphraseName(keyId))
                        client.authPublickey(user, KeyTools.load(pem, pass))
                    }
                    else -> throw IllegalArgumentException("Método de auth desconocido")
                } } catch (e: net.schmizz.sshj.userauth.UserAuthException) {
                    val allowed = try { client.userAuth.allowedMethods.joinToString(", ") } catch (_: Exception) { "" }
                    throw ConnectFailure(
                        "Autenticación rechazada para $user (contraseña o clave incorrecta)" +
                            if (allowed.isNotEmpty()) ". El servidor acepta: $allowed" else "",
                        e,
                    )
                }

                // 15 s x 4 sin respuesta => conexión muerta => evento "closed" con motivo.
                client.connection.keepAlive.keepAliveInterval = 15
                (client.connection.keepAlive as? net.schmizz.keepalive.KeepAliveRunner)?.maxAliveCount = 4

                val session = client.startSession()
                val term = if (opts.hasKey("term")) opts.getString("term")!! else "xterm-256color"
                session.allocatePTY(term, opts.getInt("cols"), opts.getInt("rows"), 0, 0, emptyMap())
                val shell = session.startShell()
                if (connecting.remove(id) == null) {
                    // disconnect() llegó mientras conectábamos: abortar.
                    client.disconnect()
                    return@execute promise.reject("CANCELLED", "Conexión cancelada")
                }
                val title = if (opts.hasKey("title")) opts.getString("title")!! else "$user@$host"
                val hostId = if (opts.hasKey("hostId")) opts.getString("hostId") else null
                val sess = Sess(client, shell, session, hostId, title)
                sessions[id] = sess
                pump(id, sess)
                syncService(id)
                promise.resolve(id)
            } catch (e: Exception) {
                connecting.remove(id)
                try { client.disconnect() } catch (_: Exception) {}
                when (e) {
                    is VaultLockedException -> promise.reject("LOCKED", "Vault bloqueado", e)
                    is ConnectFailure -> promise.reject("CONNECT_ERROR", e.message, e)
                    else -> promise.reject("CONNECT_ERROR", e.message ?: e.javaClass.simpleName, e)
                }
            }
        }
    }

    private class ConnectFailure(msg: String, cause: Throwable) : Exception(msg, cause)

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000
        const val HOSTKEY_WAIT_MS = 120_000
        const val HISTORY_BYTES = 256 * 1024
    }

    private fun pump(id: String, sess: Sess) {
        pool.execute {
            val buf = ByteArray(8192)
            try {
                val input = sess.shell.inputStream
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    sess.history.append(buf, n)
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

    /**
     * Ejecuta un comando en un canal aparte de la misma conexión (no toca la
     * shell interactiva) y devuelve su salida estándar. Pensado para sondeos
     * cortos; se corta a los timeoutMs o a los 64 KB.
     */
    @ReactMethod
    fun exec(id: String, command: String, timeoutMs: Int, promise: Promise) {
        val s = sessions[id] ?: return promise.reject("NO_SESSION", "Sesión inexistente")
        pool.execute {
            var ch: Session? = null
            val killer = java.util.Timer(true)
            try {
                ch = s.client.startSession()
                val cmd = ch.exec(command)
                val chan = ch
                killer.schedule(object : java.util.TimerTask() {
                    override fun run() { try { chan.close() } catch (_: Exception) {} }
                }, timeoutMs.toLong().coerceIn(1000, 30000))
                val out = java.io.ByteArrayOutputStream()
                val buf = ByteArray(4096)
                val input = cmd.inputStream
                while (out.size() < 65536) {
                    val n = try { input.read(buf) } catch (_: Exception) { -1 }
                    if (n < 0) break
                    out.write(buf, 0, n)
                }
                promise.resolve(out.toString("UTF-8"))
            } catch (e: Exception) {
                promise.reject("EXEC_ERROR", e.message, e)
            } finally {
                killer.cancel()
                try { ch?.close() } catch (_: Exception) {}
            }
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
        // Conexión a medias: rechazar la huella pendiente y cortar el socket.
        pendingHostKeys.remove(id)?.complete(false)
        connecting.remove(id)?.let { try { it.disconnect() } catch (_: Exception) {} }
        sessions.remove(id)?.let {
            try { it.session.close() } catch (_: Exception) {}
            try { it.client.disconnect() } catch (_: Exception) {}
            syncService()
        }
    }
}
