# JS 브리지 메서드는 리플렉션으로 호출되므로 이름을 유지해야 합니다.
-keepclassmembers class io.github.myzxit.screensolver.ScreenSolverBridge {
    @android.webkit.JavascriptInterface <methods>;
}
