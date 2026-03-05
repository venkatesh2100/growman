# Play Store Deployment Guide

This guide will help you deploy the Growman mobile app to the Google Play Store.

## Prerequisites

1. **Google Play Console Account**
   - Sign up at [Google Play Console](https://play.google.com/console)
   - Pay the one-time $25 registration fee

2. **App Signing Key**
   - Generate a keystore for signing your app
   - Keep it secure - you'll need it for all future updates

3. **App Assets**
   - App icon (512x512 PNG)
   - Feature graphic (1024x500 PNG)
   - Screenshots (at least 2 per device type)
   - Privacy policy URL (required)

## Step 1: Generate Signing Key

```bash
cd android/app
keytool -genkeypair -v -storetype PKCS12 -keystore growman-release-key.keystore -alias growman-key-alias -keyalg RSA -keysize 2048 -validity 10000
```

**Important:** Save the keystore file and passwords securely. You'll need them for all future releases.

## Step 2: Configure Signing

Create or edit `android/gradle.properties` and add:

```properties
MYAPP_RELEASE_STORE_FILE=growman-release-key.keystore
MYAPP_RELEASE_KEY_ALIAS=growman-key-alias
MYAPP_RELEASE_STORE_PASSWORD=your-store-password
MYAPP_RELEASE_KEY_PASSWORD=your-key-password
```

**Security Note:** Don't commit this file to version control. Add it to `.gitignore`.

## Step 3: Update App Version

Edit `android/app/build.gradle`:

```gradle
defaultConfig {
    applicationId "com.growman"
    minSdkVersion rootProject.ext.minSdkVersion
    targetSdkVersion rootProject.ext.targetSdkVersion
    versionCode 1        // Increment for each release
    versionName "1.0.0" // Update version string
}
```

## Step 4: Configure API URL

Update `src/config/env.ts` with your production API URL:

```typescript
export const API_URL = 'https://your-backend-url.com/api/v1';
```

Or set it via environment variable during build.

## Step 5: Build Release Bundle

```bash
cd android
./gradlew bundleRelease
```

The AAB file will be at:
`android/app/build/outputs/bundle/release/app-release.aab`

## Step 6: Test the Release Build

Before uploading, test the release build:

```bash
# Build APK for testing
cd android
./gradlew assembleRelease

# Install on device
adb install app/build/outputs/apk/release/app-release.apk
```

## Step 7: Create App in Play Console

1. Go to [Google Play Console](https://play.google.com/console)
2. Click "Create app"
3. Fill in:
   - App name: Growman
   - Default language: English
   - App or game: App
   - Free or paid: Free
   - Declarations: Accept terms

## Step 8: Complete Store Listing

Fill in all required information:

### App Details
- **App name:** Growman
- **Short description:** Your favorite plant store - shop plants online
- **Full description:** Detailed description of your app features
- **App icon:** 512x512 PNG
- **Feature graphic:** 1024x500 PNG

### Graphics
- **Phone screenshots:** At least 2 (min 320px, max 3840px)
- **Tablet screenshots:** Optional but recommended
- **TV screenshots:** Optional

### Categorization
- **App category:** Shopping
- **Content rating:** Complete questionnaire

### Privacy Policy
- **Privacy policy URL:** Required (host your privacy policy)

## Step 9: Upload Release

1. Go to "Production" → "Create new release"
2. Upload the AAB file from Step 5
3. Add release notes (what's new in this version)
4. Review and save

## Step 10: Complete Content Rating

1. Go to "Content rating"
2. Complete the questionnaire
3. Submit for rating

## Step 11: Complete App Access

1. Go to "App access"
2. Indicate if your app has restricted content
3. Complete any required forms

## Step 12: Set Up Pricing & Distribution

1. Go to "Pricing & distribution"
2. Select countries where app will be available
3. Select "Free" or set price
4. Accept content guidelines

## Step 13: Review and Publish

1. Review all sections (green checkmarks)
2. Click "Send for review"
3. Wait for Google's review (usually 1-3 days)
4. Once approved, your app will be live!

## Updating Your App

For future releases:

1. Update version in `android/app/build.gradle`:
   ```gradle
   versionCode 2  // Increment
   versionName "1.0.1"  // Update
   ```

2. Build new bundle:
   ```bash
   cd android
   ./gradlew bundleRelease
   ```

3. Upload new AAB in Play Console
4. Add release notes
5. Submit for review

## Troubleshooting

### Build Errors
- Clean build: `cd android && ./gradlew clean`
- Check Java version: Should be Java 17+
- Check Android SDK: Should have API 35 installed

### Signing Issues
- Verify keystore path in `gradle.properties`
- Check passwords are correct
- Ensure keystore file exists

### Upload Errors
- AAB file size should be < 150MB
- Check version code is incremented
- Verify all required fields are filled

## Security Best Practices

1. **Never commit keystore to git**
   - Add `*.keystore` to `.gitignore`
   - Store keystore securely (password manager, secure storage)

2. **Use App Signing by Google Play**
   - Google can manage your app signing key
   - More secure and easier key management

3. **Keep API keys secure**
   - Don't hardcode in source code
   - Use environment variables or secure storage

## Additional Resources

- [Google Play Console Help](https://support.google.com/googleplay/android-developer)
- [Android App Bundle Guide](https://developer.android.com/guide/app-bundle)
- [React Native Deployment](https://reactnative.dev/docs/signed-apk-android)

