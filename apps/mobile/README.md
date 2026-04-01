# Growman Mobile App

React Native mobile application for the Growman e-commerce platform. This app shares the same backend APIs, business logic, and UI design as the web application.

## Features

- 🛍️ Product browsing and search
- 🛒 Shopping cart functionality
- 👤 User authentication (email/password)
- 📦 Order management
- 💳 Checkout and payment processing
- 📱 Native mobile experience

## Prerequisites

- Node.js >= 18
- React Native development environment set up
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)

## Installation

1. Install dependencies:
```bash
pnpm install
```

2. For iOS (macOS only):
```bash
cd ios && pod install && cd ..
```

3. Start Metro bundler:
```bash
pnpm start
```

4. Run on Android:
```bash
pnpm android
```

5. Run on iOS (macOS only):
```bash
pnpm ios
```

## Configuration

### API Configuration

Set the API URL in your environment or create a `.env` file:

```env
API_URL=https://your-backend-url.com/api/v1
```

For development, the default is `http://localhost:8080/api/v1`. Make sure your backend is running and accessible.

## Building for Production

### Android

1. Generate a signing key (if you don't have one):
```bash
keytool -genkeypair -v -storetype PKCS12 -keystore my-release-key.keystore -alias my-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

2. Create `android/gradle.properties` and add:
```properties
MYAPP_RELEASE_STORE_FILE=my-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=my-key-alias
MYAPP_RELEASE_STORE_PASSWORD=*****
MYAPP_RELEASE_KEY_PASSWORD=*****
```

3. Build the release APK:
```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

4. Build the release AAB (for Play Store):
```bash
cd android
./gradlew bundleRelease
```

The AAB will be at: `android/app/build/outputs/bundle/release/app-release.aab`

### iOS

1. Open the project in Xcode:
```bash
open ios/Growman.xcworkspace
```

2. Configure signing in Xcode
3. Build for App Store in Xcode

## Play Store Deployment

### Prerequisites

1. Google Play Console account
2. App signing key (keystore)
3. App bundle (AAB) file

### Steps

1. **Prepare your app:**
   - Update version in `android/app/build.gradle`:
     ```gradle
     versionCode 2  // Increment for each release
     versionName "1.0.1"  // Update version string
     ```

2. **Build the release bundle:**
   ```bash
   cd android
   ./gradlew bundleRelease
   ```

3. **Upload to Play Console:**
   - Go to [Google Play Console](https://play.google.com/console)
   - Create a new app or select existing
   - Go to "Production" → "Create new release"
   - Upload the AAB file from `android/app/build/outputs/bundle/release/app-release.aab`
   - Fill in release notes
   - Review and publish

### App Information Required

- App name: Growman
- Short description: Your favorite plant store
- Full description: Detailed description of your app
- App icon: 512x512 PNG
- Feature graphic: 1024x500 PNG
- Screenshots: At least 2 screenshots per device type

### Version Management

- **versionCode**: Integer that must be incremented for each release
- **versionName**: User-visible version string (e.g., "1.0.1")

Update both in `android/app/build.gradle` before each release.

## Project Structure

```
mobile/
├── android/          # Android native code
├── ios/             # iOS native code
├── src/
│   ├── components/  # Reusable components
│   ├── screens/     # Screen components
│   ├── navigation/  # Navigation setup
│   ├── lib/         # API client and utilities
│   └── store/       # State management (Zustand)
├── App.tsx          # Root component
└── package.json     # Dependencies
```

## Shared Code

This app shares:
- API client logic with the web app
- Business logic (auth, cart stores)
- Type definitions
- Backend API endpoints

## Troubleshooting

### Metro bundler issues
```bash
pnpm start --reset-cache
```

### Android build issues
```bash
cd android
./gradlew clean
cd ..
pnpm android
```

### iOS build issues
```bash
cd ios
pod deintegrate
pod install
cd ..
```

## License

Same as the main project.

