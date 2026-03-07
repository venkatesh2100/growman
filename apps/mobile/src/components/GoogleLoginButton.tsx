import React, { useState, useEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { GOOGLE_CLIENT_ID } from '../config/env';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

type RootStackParamList = {
  Signup: undefined;
  Main: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function GoogleLoginButton() {
  const navigation = useNavigation<NavigationProp>();
  const [loading, setLoading] = useState(false);
  const setToken = useAuthStore((state) => state.setToken);

  useEffect(() => {
    // Configure Google Sign In
    if (GOOGLE_CLIENT_ID) {
      GoogleSignin.configure({
        webClientId: GOOGLE_CLIENT_ID,
        offlineAccess: true,
      });
    }
  }, []);

  const handleGoogleLogin = async () => {
    if (!GOOGLE_CLIENT_ID) {
      console.warn('Google Client ID not configured');
      return;
    }

    try {
      setLoading(true);
      
      // Check if Google Play Services are available
      await GoogleSignin.hasPlayServices();
      
      // Sign in
      const userInfo = await GoogleSignin.signIn();
      
      if (userInfo?.data?.idToken) {
        // Send token to backend for verification
        const res = await apiFetch('/auth/google', {
          method: 'POST',
          body: JSON.stringify({ token: userInfo.data.idToken }),
        });

        if (!res.ok) {
          // User doesn't exist, redirect to signup
          const errorData = await res.json().catch(() => ({}));
          if (res.status === 404 || errorData.error?.includes('not exist')) {
            // Navigate to signup screen
            navigation.navigate('Signup');
            return;
          }
          throw new Error('Google login failed');
        }

        const data = await res.json();
        setToken(data.token);
        // Navigation will automatically switch to Main stack
      }
    } catch (error: any) {
      console.error('Google login error:', error);
      
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        // User cancelled the login flow
        console.log('User cancelled Google sign in');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        // Operation (e.g. sign in) is in progress already
        console.log('Google sign in already in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        // Play services not available or outdated
        console.log('Play services not available');
      } else {
        // Some other error happened
        console.log('Google sign in error:', error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!GOOGLE_CLIENT_ID) {
    console.warn('Google Client ID not configured');
    return null;
  }

  return (
    <TouchableOpacity
      style={[styles.button, loading && styles.buttonDisabled]}
      onPress={handleGoogleLogin}
      disabled={loading}>
      {loading ? (
        <ActivityIndicator color="#374151" />
      ) : (
        <View style={styles.buttonContent}>
          <View style={styles.googleIcon}>
            <Text style={styles.googleIconText}>G</Text>
          </View>
          <Text style={styles.buttonText}>Sign in with Google</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  googleIcon: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
  },
  googleIconText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#4285F4',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
});
