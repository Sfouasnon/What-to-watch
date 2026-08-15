plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.whattowatch.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.whattowatch.tv"
        minSdk = 22
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "WEB_APP_URL", "\"https://what-to-watch-flax-xi.vercel.app/tv\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
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
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("androidx.webkit:webkit:1.13.0")
}
