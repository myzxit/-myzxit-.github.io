package io.github.myzxit.screensolver

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import androidx.core.content.getSystemService

class ScreenSolverApp : Application() {

    companion object {
        const val CHANNEL_ID = "screen_capture"
    }

    override fun onCreate() {
        super.onCreate()
        // 화면 공유 중임을 항상 알리는 채널. 사용자가 끄지 못하도록 낮은 중요도로 상시 표시합니다.
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_capture),
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = getString(R.string.channel_capture_desc)
            setShowBadge(false)
        }
        getSystemService<NotificationManager>()?.createNotificationChannel(channel)
    }
}
