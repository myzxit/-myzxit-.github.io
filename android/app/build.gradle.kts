plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.github.myzxit.screensolver"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.github.myzxit.screensolver"
        minSdk = 29           // Android 10+ (foregroundServiceType 지원)
        targetSdk = 35        // Android 15
        versionCode = 1
        versionName = "1.0.0"

        // 웹 UI 와 네이티브 브리지의 계약 버전 (js/android.js 와 일치해야 합니다)
        buildConfigField("int", "BRIDGE_VERSION", "1")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
            buildConfigField("boolean", "VERBOSE_LOG", "true")
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            // 릴리스에서는 디버그 로그를 끕니다.
            buildConfigField("boolean", "VERBOSE_LOG", "false")
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    // WebViewAssetLoader: 웹 자산을 https 오리진으로 제공해 CORS·localStorage 가 정상 동작하게 합니다.
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}

/*
 * 웹 앱(저장소 루트)을 그대로 APK 자산으로 복사합니다.
 * 웹과 앱이 같은 소스를 쓰므로 UI·AI 엔진이 갈라지지 않습니다.
 */
val webRoot = rootProject.projectDir.parentFile
val webAssets = layout.projectDirectory.dir("src/main/assets/www")

val syncWebAssets by tasks.registering(Sync::class) {
    description = "저장소 루트의 웹 앱을 app/src/main/assets/www 로 동기화합니다."
    from(webRoot) {
        include("index.html")
        include("manifest.webmanifest")
        include("css/**")
        include("js/**")
        include("icons/**")
    }
    into(webAssets)
    // 서비스 워커는 앱 안에서 쓰지 않습니다(공유 대상은 웹 전용).
    exclude("sw.js")
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

tasks.named("clean") {
    doLast { webAssets.asFile.deleteRecursively() }
}
