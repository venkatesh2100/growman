# Running on Physical Android Device

## Quick Start

Your device is detected! Follow these steps:

### Step 1: Start Metro Bundler

In Terminal 1:
```bash
cd apps/mobile
pnpm start
```

Keep this running. Metro bundler will serve the JavaScript bundle to your device.

### Step 2: Run on Device

In Terminal 2 (new terminal):
```bash
cd apps/mobile
pnpm android
```

This will:
1. Build the Android app
2. Install it on your connected device
3. Launch the app automatically

## Troubleshooting

### Device Not Detected

If `adb devices` shows no devices:

1. **Check USB connection:**
   - Use a data cable (not charging-only)
   - Try a different USB port
   - Try a different cable

2. **Enable USB Debugging:**
   - Go to Settings → About Phone
   - Tap "Build Number" 7 times to enable Developer Options
   - Go to Settings → Developer Options
   - Enable "USB Debugging"
   - Accept the USB debugging prompt on your phone

3. **Restart ADB:**
   ```bash
   adb kill-server
   adb start-server
   adb devices
   ```

### Build Errors

If you get build errors:

```bash
cd apps/mobile/android
./gradlew clean
cd ../..
pnpm android
```

### App Crashes on Launch

1. Check Metro bundler is running
2. Check device and computer are on same network (for Metro)
3. Check logs:
   ```bash
   adb logcat | grep ReactNative
   ```

### Permission Denied

If you get permission errors:

```bash
# Make gradlew executable
chmod +x apps/mobile/android/gradlew
```

## Alternative: Using Android Studio

1. Open `apps/mobile/android` in Android Studio
2. Select your device from the device dropdown
3. Click Run (green play button)

## Development Workflow

1. **Keep Metro running** in one terminal
2. **Make code changes** - Metro will automatically reload
3. **Shake device** or press `R` in Metro terminal to reload
4. **Press `D`** in Metro terminal to open developer menu

## Hot Reload

- Shake your device to open developer menu
- Or press `Ctrl+M` (Windows/Linux) or `Cmd+M` (Mac) in the app
- Select "Reload" to refresh the app

