package com.lulossh.ssh

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.text.InputType
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

    private fun handleKey(event: KeyEvent): Boolean {
        val seq = when (event.keyCode) {
            KeyEvent.KEYCODE_DEL -> "\u007f"
            KeyEvent.KEYCODE_FORWARD_DEL -> "\u001b[3~"
            KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "\r"
            KeyEvent.KEYCODE_TAB -> if (event.isShiftPressed) "\u001b[Z" else "\t"
            KeyEvent.KEYCODE_ESCAPE -> "\u001b"
            KeyEvent.KEYCODE_DPAD_UP -> "\u001b[A"
            KeyEvent.KEYCODE_DPAD_DOWN -> "\u001b[B"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "\u001b[C"
            KeyEvent.KEYCODE_DPAD_LEFT -> "\u001b[D"
            KeyEvent.KEYCODE_MOVE_HOME -> "\u001b[H"
            KeyEvent.KEYCODE_MOVE_END -> "\u001b[F"
            KeyEvent.KEYCODE_PAGE_UP -> "\u001b[5~"
            KeyEvent.KEYCODE_PAGE_DOWN -> "\u001b[6~"
            else -> {
                val c = event.getUnicodeChar(event.metaState and KeyEvent.META_CTRL_MASK.inv())
                if (c == 0) return false
                var s = String(Character.toChars(c))
                if (event.isCtrlPressed && c in 0x40..0x7f) s = (c and 0x1f).toChar().toString()
                if (event.isAltPressed) s = "\u001b$s"
                s
            }
        }
        onData(seq)
        return true
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
