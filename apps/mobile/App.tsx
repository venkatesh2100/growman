import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import { ToastContainer } from './src/components/Toast';
import Chatbot from './src/components/Chatbot';

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator />
        <ToastContainer />
        <Chatbot />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;

