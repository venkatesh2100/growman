# Fix for pnpm Workspace + React Native Gradle Plugin

## Issue
React Native 0.76's gradle plugin doesn't resolve correctly with pnpm's workspace structure because buildscript dependencies are resolved before `includeBuild` projects are available.

## Quick Fix

Run the setup script before building:

```bash
cd apps/mobile
./setup-android.sh
```

Then try building again:

```bash
pnpm android
```

## Alternative Solutions

### Option 1: Use npm/yarn for mobile app only
```bash
cd apps/mobile
rm -rf node_modules package-lock.json
npm install
npm run android
```

### Option 2: Use pnpm with public-hoist-pattern
Add to root `.npmrc`:
```
public-hoist-pattern[]=*react-native*
public-hoist-pattern[]=*@react-native*
```

### Option 3: Manual symlink (already done by setup script)
The setup script creates the necessary symlinks. If it doesn't work, manually create:
```bash
mkdir -p apps/mobile/node_modules/@react-native
ln -sf ../../../node_modules/.pnpm/@react-native+gradle-plugin@0.76.5/node_modules/@react-native/gradle-plugin \
  apps/mobile/node_modules/@react-native/gradle-plugin
```

## Current Status
The gradle plugin is symlinked, but Gradle still can't resolve it as a Maven dependency. This is a known limitation of React Native 0.76 with pnpm workspaces.

## Workaround
Consider using npm or yarn for the mobile app, or wait for React Native to better support pnpm workspaces.

