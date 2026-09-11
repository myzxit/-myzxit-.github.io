package io.github.myzxit.screensolver

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * API 키처럼 기기 밖으로 나가면 안 되는 값의 보관소.
 *
 * 웹 앱은 값을 localStorage 에 평문으로 둘 수밖에 없지만, 앱 안에서는
 * **Android Keystore** 에 들어 있는 키로 AES-GCM 암호화해서 저장합니다.
 * 암호화 키 자체는 하드웨어(TEE/StrongBox)에 남고 앱이 읽어낼 수 없으므로,
 * 저장 파일만 빼내도 값을 복원할 수 없습니다.
 *
 * 설계 메모
 * - `androidx.security:security-crypto` 는 아직 alpha 라 의존성으로 넣지 않고,
 *   Keystore + AES/GCM 을 직접 씁니다. 새 의존성이 없어 오프라인 빌드도 됩니다.
 * - GCM 은 매번 새 IV 가 필요합니다. IV 를 암호문 앞에 붙여 함께 보관합니다.
 * - 복호화 실패(기기 초기화·백업 복원·키 무효화)는 예외를 던지지 않고 null 을
 *   돌려줍니다. 이 경우 사용자는 키를 다시 입력하면 됩니다.
 * - 값은 절대 로그로 남기지 않습니다. (§50)
 */
object SecureStore {

    private const val PREFS = "screensolver.secure"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "screensolver.secrets.v1"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val TAG_BITS = 128

    /** 저장 형식 버전. 앞으로 형식이 바뀌어도 예전 값을 알아볼 수 있게 합니다. */
    private const val FORMAT_V1 = 1.toByte()

    /** 이 기기에서 암호화 저장을 쓸 수 있는지 */
    fun isAvailable(context: Context): Boolean = try {
        secretKey() != null
    } catch (_: Exception) {
        false
    }

    /** 없으면 만들고, 있으면 가져옵니다. 실패하면 null. */
    private fun secretKey(): SecretKey? {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                // 잠금화면 인증을 요구하지 않습니다. 화면을 켠 채 문제를 푸는
                // 도중에 키를 못 읽으면 앱이 멈춰 버리기 때문입니다.
                .setUserAuthenticationRequired(false)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** 저장된 값을 돌려줍니다. 없거나 복호화할 수 없으면 null. */
    fun get(context: Context, name: String): String? = try {
        val stored = prefs(context).getString(name, null)
        if (stored.isNullOrEmpty()) null else decrypt(stored)
    } catch (_: Exception) {
        null
    }

    /** 값을 암호화해 저장합니다. 빈 값이면 삭제와 같습니다. */
    fun put(context: Context, name: String, value: String): Boolean = try {
        if (value.isEmpty()) {
            delete(context, name)
        } else {
            prefs(context).edit().putString(name, encrypt(value)).apply()
            true
        }
    } catch (_: Exception) {
        false
    }

    fun delete(context: Context, name: String): Boolean = try {
        prefs(context).edit().remove(name).apply()
        true
    } catch (_: Exception) {
        false
    }

    private fun encrypt(plain: String): String {
        val key = secretKey() ?: throw IllegalStateException("no key")
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key)
        val iv = cipher.iv
        val body = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        // [버전][IV 길이][IV][암호문] — IV 길이를 함께 적어 두면 구현이 12바이트가
        // 아닌 IV 를 쓰더라도 그대로 복호화할 수 있습니다.
        val joined = ByteArray(2 + iv.size + body.size)
        joined[0] = FORMAT_V1
        joined[1] = iv.size.toByte()
        iv.copyInto(joined, 2)
        body.copyInto(joined, 2 + iv.size)
        return Base64.encodeToString(joined, Base64.NO_WRAP)
    }

    private fun decrypt(stored: String): String? {
        val joined = Base64.decode(stored, Base64.NO_WRAP)
        if (joined.size < 3 || joined[0] != FORMAT_V1) return null
        val ivLen = joined[1].toInt()
        if (ivLen !in 1..16 || joined.size <= 2 + ivLen) return null

        val key = secretKey() ?: return null
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(
            Cipher.DECRYPT_MODE,
            key,
            GCMParameterSpec(TAG_BITS, joined, 2, ivLen),
        )
        val plain = cipher.doFinal(joined, 2 + ivLen, joined.size - 2 - ivLen)
        return String(plain, Charsets.UTF_8)
    }
}
