# Troubleshooting Guide

## Common Issues and Solutions

### Metro Bundler Already Running

If you see "A dev server is already running for this project on port 8081":

**Solution:**
```bash
# Kill the existing process
lsof -ti:8081 | xargs kill -9

# Or use React Native's built-in command
pnpm start --reset-cache
```

### Android Build Issues

#### 1. Gradle Build Fails

**Solution:**
```bash
cd android
./gradlew clean
cd ..
pnpm android
```

#### 2. "SDK location not found"

**Solution:**
Create `android/local.properties`:
```properties
sdk.dir=/path/to/your/Android/sdk
```

Or set environment variable:
```bash
export ANDROID_HOME=$HOME/Android/Sdk
export PATH=$PATH:$ANDROID_HOME/tools
export PATH=$PATH:$ANDROID_HOME/platform-tools
```

#### 3. "Could not find or load main class"

**Solution:**
```bash
cd android
./gradlew wrapper --gradle-version 8.9
cd ..
```

### Package Issues

#### Google Sign-In Deprecation Warning

The warning about `@react-native-community/google-signin` is just a deprecation notice. The package still works. If you want to use the new package:

```bash
pnpm remove @react-native-community/google-signin
pnpm add @react-native-google-signin/google-signin
```

#### React Native Vector Icons Warning

This is also a deprecation notice. The package still works. To migrate later, see:
https://github.com/oblador/react-native-vector-icons/blob/master/MIGRATION.md

### TypeScript Errors

TypeScript errors are expected until all dependencies are installed. After running `pnpm install`, most errors should resolve.

### Port Already in Use

If port 8081 is in use:

```bash
# Find and kill the process
lsof -ti:8081 | xargs kill -9

# Or use a different port
pnpm start --port 8082
```

### Cache Issues

Clear all caches:

```bash
# Clear Metro bundler cache
pnpm start --reset-cache

# Clear watchman (if installed)
watchman watch-del-all

# Clear npm/pnpm cache
pnpm store prune

# Clear Android build cache
cd android
./gradlew clean
cd ..
```

### Android Emulator Not Starting

1. Make sure Android Studio is installed
2. Create an AVD (Android Virtual Device) in Android Studio
3. Start the emulator before running `pnpm android`

Or use command line:
```bash
emulator -avd <AVD_NAME>
```

### Missing Android SDK

Install required SDK components:
```bash
# Using Android Studio SDK Manager
# Or using sdkmanager command line tool
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

### React Native CLI Not Found

If you see errors about React Native CLI:

```bash
# Make sure @react-native-community/cli is installed
pnpm add -D @react-native-community/cli

# Or install globally (not recommended)
npm install -g @react-native-community/cli
```

## Getting Help

1. Check React Native documentation: https://reactnative.dev/docs/getting-started
2. Check Metro bundler logs for detailed error messages
3. Check Android Studio logs for native build errors
4. Clear caches and try again

