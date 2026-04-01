# React Native App Setup Guide

## Quick Start

1. **Install dependencies:**
   ```bash
   cd apps/mobile
   pnpm install
   ```

2. **For iOS (macOS only):**
   ```bash
   cd ios
   pod install
   cd ..
   ```

3. **Start Metro bundler:**
   ```bash
   pnpm start
   ```

4. **Run on Android:**
   ```bash
   pnpm android
   ```

5. **Run on iOS (macOS only):**
   ```bash
   pnpm ios
   ```

## Configuration

### API URL

Update the API URL in `src/config/env.ts`:

```typescript
export const API_URL = 'https://your-backend-url.com/api/v1';
```

Or use environment variables with `react-native-config`:

1. Install: `pnpm add react-native-config`
2. Create `.env` file:
   ```
   API_URL=https://your-backend-url.com/api/v1
   ```
3. Update `src/config/env.ts` to use `Config.API_URL`

## Development Setup

### Prerequisites

- Node.js >= 18
- React Native CLI
- Android Studio (for Android)
- Xcode (for iOS, macOS only)
- Java Development Kit (JDK 17+)

### Android Setup

1. Install Android Studio
2. Install Android SDK (API 35)
3. Set up Android emulator or connect physical device
4. Enable USB debugging on physical device

### iOS Setup (macOS only)

1. Install Xcode from App Store
2. Install CocoaPods: `sudo gem install cocoapods`
3. Run `pod install` in `ios/` directory

## Troubleshooting

### Metro bundler cache issues
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

### Type errors
The TypeScript errors you see are expected until dependencies are installed. After running `pnpm install`, most errors should resolve.

## Next Steps

- See [README.md](./README.md) for app features
- See [DEPLOYMENT.md](./DEPLOYMENT.md) for Play Store deployment guide

