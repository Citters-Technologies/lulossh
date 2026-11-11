package com.lulossh

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "LuloSSH"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: android.os.Bundle?) {
    super.onCreate(savedInstanceState)
    com.lulossh.ssh.SshService.handleIntent(intent)
  }

  /** Toque en la notificación de sesiones: JS abre esa sesión al volver. */
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    com.lulossh.ssh.SshService.handleIntent(intent)
  }

  /** Volumen = zoom de la terminal cuando está activo (ver VolumeKeys). */
  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean =
      com.lulossh.ssh.VolumeKeys.handle(event) || super.dispatchKeyEvent(event)
}
