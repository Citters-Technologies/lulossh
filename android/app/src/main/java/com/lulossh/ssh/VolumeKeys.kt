package com.lulossh.ssh

import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.lang.ref.WeakReference

/**
 * Teclas de volumen como zoom de la terminal (como hacía JuiceSSH).
 * Solo se capturan mientras JS lo pide (pantalla de terminal visible);
 * el resto del tiempo el volumen funciona normal.
 */
object VolumeKeys {
    @Volatile var enabled = false
    private var context: WeakReference<ReactApplicationContext>? = null

    fun attach(rc: ReactApplicationContext) {
        context = WeakReference(rc)
    }

    /** Devuelve true si el evento se ha consumido. Llamar desde la Activity. */
    fun handle(event: KeyEvent): Boolean {
        if (!enabled) return false
        val dir = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> "up"
            KeyEvent.KEYCODE_VOLUME_DOWN -> "down"
            else -> return false
        }
        if (event.action == KeyEvent.ACTION_DOWN) {
            val rc = context?.get() ?: return false
            rc.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("volumeKey", Arguments.createMap().apply { putString("direction", dir) })
        }
        return true // consumir también ACTION_UP para que no suene/cambie el volumen
    }
}
