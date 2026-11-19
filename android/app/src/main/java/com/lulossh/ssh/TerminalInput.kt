package com.lulossh.ssh

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.text.InputType
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.BaseInputConnection
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout

/**
 * Vista invisible que recibe el teclado del sistema para la terminal.
 *
 * Se declara al IME como "contraseña visible sin sugerencias", el truco que
 * usan Termux y otros terminales: así ningún teclado (Gboard, el de Xiaomi,
 * Samsung, SwiftKey…) aplica mayúscula inicial, autocorrección ni predicción.
 * Lo escrito se envía a JS como texto/secuencias de terminal.
 */
@SuppressLint("ViewConstructor")
class TerminalInputView(context: Context, private val onData: (String) -> Unit) : View(context) {

    init {
        isFocusable = true
        isFocusableInTouchMode = true
    }

    override fun onCheckIsTextEditor() = true

    override fun onCreateInputConnection(outAttrs: EditorInfo): InputConnection {
        outAttrs.inputType = InputType.TYPE_CLASS_TEXT or
            InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or
            InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        outAttrs.imeOptions = EditorInfo.IME_FLAG_NO_FULLSCREEN or
            EditorInfo.IME_FLAG_NO_EXTRACT_UI or
            EditorInfo.IME_ACTION_NONE

        return object : BaseInputConnection(this, true) {
            private fun flush() {
                val e = editable ?: return
                if (e.isNotEmpty()) {
                    // El Enter de algunos teclados llega como "\n": la terminal quiere "\r".
                    onData(e.toString().replace('\n', '\r'))
                    e.clear()
                }
            }

            override fun commitText(text: CharSequence?, newCursorPosition: Int): Boolean {
                super.commitText(text, newCursorPosition)
                flush()
                return true
            }

            override fun finishComposingText(): Boolean {
                super.finishComposingText()
                flush()
                return true
            }

            override fun deleteSurroundingText(beforeLength: Int, afterLength: Int): Boolean {
                // Con el editable vacío, "borrar" = Backspace en la terminal.
                repeat(maxOf(beforeLength, 1)) { onData("\u007f") }
                return super.deleteSurroundingText(beforeLength, afterLength)
            }

            override fun sendKeyEvent(event: KeyEvent): Boolean {
                if (event.action == KeyEvent.ACTION_DOWN) handleKey(event)
                return true
            }
        }
    }

    // Teclas físicas (teclado Bluetooth/USB) o enviadas por el IME como KeyEvent.
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean =
        handleKey(event) || super.onKeyDown(keyCode, event)

    /** Acento pendiente de una tecla muerta (´ ` ^ ¨ ~), o 0. */
    private var pendingAccent = 0

    /**
     * Traduce una tecla a lo que espera la terminal (como xterm). Los
     * modificadores en flechas/Inicio/Fin/F1-F12 van como CSI 1;m X, con
     * m = 1 + Shift(1) + Alt(2) + Ctrl(4).
     */
    private fun handleKey(event: KeyEvent): Boolean {
        val mod = 1 + (if (event.isShiftPressed) 1 else 0) +
            (if (event.isAltPressed) 2 else 0) + (if (event.isCtrlPressed) 4 else 0)
        fun csiLetter(x: Char) = if (mod == 1) "\u001b[$x" else "\u001b[1;$mod$x"
        fun csiTilde(n: Int) = if (mod == 1) "\u001b[$n~" else "\u001b[$n;$mod~"
        fun ss3(x: Char) = if (mod == 1) "\u001bO$x" else "\u001b[1;$mod$x"
        val seq = when (event.keyCode) {
            KeyEvent.KEYCODE_DEL -> if (event.isAltPressed) "\u001b\u007f" else "\u007f"
            KeyEvent.KEYCODE_FORWARD_DEL -> csiTilde(3)
            KeyEvent.KEYCODE_INSERT -> csiTilde(2)
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "\r"
            KeyEvent.KEYCODE_TAB -> if (event.isShiftPressed) "\u001b[Z" else "\t"
            KeyEvent.KEYCODE_ESCAPE -> "\u001b"
            KeyEvent.KEYCODE_DPAD_UP -> csiLetter('A')
            KeyEvent.KEYCODE_DPAD_DOWN -> csiLetter('B')
            KeyEvent.KEYCODE_DPAD_RIGHT -> csiLetter('C')
            KeyEvent.KEYCODE_DPAD_LEFT -> csiLetter('D')
            KeyEvent.KEYCODE_MOVE_HOME -> csiLetter('H')
            KeyEvent.KEYCODE_MOVE_END -> csiLetter('F')
            KeyEvent.KEYCODE_PAGE_UP -> csiTilde(5)
            KeyEvent.KEYCODE_PAGE_DOWN -> csiTilde(6)
            KeyEvent.KEYCODE_F1 -> ss3('P')
            KeyEvent.KEYCODE_F2 -> ss3('Q')
            KeyEvent.KEYCODE_F3 -> ss3('R')
            KeyEvent.KEYCODE_F4 -> ss3('S')
            KeyEvent.KEYCODE_F5 -> csiTilde(15)
            KeyEvent.KEYCODE_F6 -> csiTilde(17)
            KeyEvent.KEYCODE_F7 -> csiTilde(18)
            KeyEvent.KEYCODE_F8 -> csiTilde(19)
            KeyEvent.KEYCODE_F9 -> csiTilde(20)
            KeyEvent.KEYCODE_F10 -> csiTilde(21)
            KeyEvent.KEYCODE_F11 -> csiTilde(23)
            KeyEvent.KEYCODE_F12 -> csiTilde(24)
            else -> charFor(event) ?: return false
        }
        if (seq.isNotEmpty()) onData(seq)
        return true
    }

    /** Carácter de la tecla con Ctrl/Alt y teclas muertas; null si no produce nada. */
    private fun charFor(event: KeyEvent): String? {
        // Ctrl+Espacio = NUL (marcar en emacs, prefijos de tmux…).
        if (event.isCtrlPressed && event.keyCode == KeyEvent.KEYCODE_SPACE) return "\u0000"
        val c = event.getUnicodeChar(
            event.metaState and (KeyEvent.META_CTRL_MASK or KeyEvent.META_ALT_MASK).inv(),
        )
        if (c == 0) return null
        if (c and KeyCharacterMap.COMBINING_ACCENT != 0) {
            // Tecla muerta: esperar a la siguiente (´ + a = á).
            pendingAccent = c and KeyCharacterMap.COMBINING_ACCENT_MASK
            return ""
        }
        var ch = c
        if (pendingAccent != 0) {
            val accent = pendingAccent
            pendingAccent = 0
            val composed = KeyCharacterMap.getDeadChar(accent, c)
            if (composed != 0) {
                ch = composed
            } else if (c == ' '.code) {
                ch = accent // acento + espacio = el acento solo
            } else {
                return String(Character.toChars(accent)) + String(Character.toChars(c))
            }
        }
        var s = String(Character.toChars(ch))
        if (event.isCtrlPressed) {
            s = when {
                ch in 0x40..0x7f -> (ch and 0x1f).toChar().toString()
                ch == '/'.code -> "\u001f"
                ch in '2'.code..'8'.code -> "\u0000\u001b\u001c\u001d\u001e\u001f\u007f"[ch - '2'.code].toString()
                else -> s
            }
        }
        if (event.isAltPressed) s = "\u001b$s"
        return s
    }
}

/** Gestiona la única TerminalInputView, añadida a la Activity al vuelo. */
object TerminalInput {
    private var view: TerminalInputView? = null

    fun show(activity: Activity, onData: (String) -> Unit) {
        val v = view?.takeIf { it.context === activity } ?: TerminalInputView(activity, onData).also { nv ->
            view?.let { (it.parent as? ViewGroup)?.removeView(it) }
            val root = activity.findViewById<FrameLayout>(android.R.id.content)
            // 1x1 px y transparente: solo existe para recibir el teclado.
            root.addView(nv, FrameLayout.LayoutParams(1, 1))
            nv.alpha = 0f
            view = nv
        }
        v.requestFocus()
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.restartInput(v)
        imm.showSoftInput(v, InputMethodManager.SHOW_IMPLICIT)
    }

    /**
     * Si el foco se lo ha llevado otra vista (p. ej. el WebView al tocar la
     * consola), devolverlo a la nuestra. Sin esto, el teclado acaba escribiendo
     * en el WebView, donde el retroceso con el campo vacío se pierde.
     */
    fun ensureFocus(activity: Activity) {
        val v = view ?: return
        if (v.hasFocus()) return
        v.requestFocus()
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.restartInput(v)
    }

    fun hide(activity: Activity) {
        val v = view ?: return
        val imm = activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(v.windowToken, 0)
        v.clearFocus()
    }

    fun detach() {
        view?.let { (it.parent as? ViewGroup)?.removeView(it) }
        view = null
    }
}
