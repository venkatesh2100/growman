import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { GOOGLE_CLIENT_ID } from '../config/env';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

// Complete the auth session
WebBrowser.maybeCompleteAuthSession();

type RootStackParamList = {
  Signup: undefined;
  Main: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function GoogleLoginButton() {
  const navigation = useNavigation<NavigationProp>();
  const [loading, setLoading] = useState(false);
  const setToken = useAuthStore((state) => state.setToken);

  const handleGoogleLogin = async () => {
    if (!GOOGLE_CLIENT_ID) {
      console.warn('Google Client ID not configured');
      return;
    }

    try {
      setLoading(true);

      // Create redirect URI
      const redirectUri = AuthSession.makeRedirectUri();

      // Create auth request
      const request = new AuthSession.AuthRequest({
        clientId: GOOGLE_CLIENT_ID,
        scopes: ['openid', 'profile', 'email'],
        responseType: AuthSession.ResponseType.Token,
        redirectUri,
      });

      // Get discovery document
      const discovery = {
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
      };

      // Start auth session
      const result = await request.promptAsync(discovery);

      if (result.type === 'success' && result.params.access_token) {
        // Send token to backend for verification
        const res = await apiFetch('/auth/google', {
          method: 'POST',
          body: JSON.stringify({ token: result.params.access_token }),
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
      } else if (result.type === 'error') {
        console.error('Google auth error:', result.error);
      }
    } catch (error) {
      console.error('Google login error:', error);
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