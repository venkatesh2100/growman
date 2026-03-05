import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { apiFetch } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import GoogleLoginButton from '../components/GoogleLoginButton';
import { GOOGLE_CLIENT_ID } from '../config/env';

type RootStackParamList = {
  Signup: undefined;
  ForgotPassword: undefined;
  Main: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function LoginScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { setToken } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleLogin = async () => {
    if (!email || !password) {
      setError('Please fill in all fields');
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const response = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        let errorMessage = 'Login failed';
        try {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const errorData = await response.json();
            const apiError = errorData.error || errorData.message;

            if (apiError) {
              if (apiError.includes('invalid credentials') || apiError.includes('unauthorized')) {
                errorMessage = 'Invalid email/phone or password. Please check and try again.';
              } else if (apiError.includes('not found') || apiError.includes('does not exist')) {
                errorMessage = 'No account found with this email/phone. Please sign up first.';
              } else {
                errorMessage = apiError;
              }
            }
          } else {
            const text = await response.text();
            errorMessage = text || `Server returned ${response.status}`;
          }
        } catch {
          errorMessage = `Server returned ${response.status}`;
        }

        setError(errorMessage);
        Alert.alert('Login Failed', errorMessage);
        return;
      }

      const data = await response.json();
      setToken(data.token);
      setSuccess(true);
      Alert.alert('Success', 'Login successful! Welcome back!');
      // Navigation will automatically switch to Main stack
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to login. Please try again.';
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.content}>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Icon name="login" size={32} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <Text style={styles.title}>Sign in to your account</Text>
            <Text style={styles.subtitle}>
              Or{' '}
              <Text style={styles.linkTextInline} onPress={() => navigation.navigate('Signup')}>
                create a new account
              </Text>
            </Text>
          </Animated.View>

          <View style={styles.form}>
            {error && (
              <Animated.View entering={FadeInDown.duration(200)} style={styles.errorContainer}>
                <Icon name="error" size={20} color="#DC2626" />
                <Text style={styles.errorText}>{error}</Text>
              </Animated.View>
            )}

            {success && (
              <Animated.View entering={FadeInDown.duration(200)} style={styles.successContainer}>
                <Icon name="check-circle" size={20} color="#16A34A" />
                <Text style={styles.successText}>Login successful! Redirecting...</Text>
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.delay(300).duration(400)}>
              <View style={styles.inputContainer}>
                <Icon name="email" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Email or phone number"
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    setError(null);
                  }}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(400).duration(400)}>
              <View style={styles.inputContainer}>
                <Icon name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setError(null);
                  }}
                  secureTextEntry
                  placeholderTextColor="#9CA3AF"
                />
              </View>
            </Animated.View>

            <Animated.View entering={FadeInDown.delay(500).duration(400)}>
              <TouchableOpacity
                style={[styles.primaryButton, (loading || success) && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading || success}>
                {loading ? (
                  <>
                    <ActivityIndicator color="#FFFFFF" size="small" />
                    <Text style={styles.primaryButtonText}>Signing in...</Text>
                  </>
                ) : (
                  <>
                    <Icon name="login" size={20} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>Sign in</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            {GOOGLE_CLIENT_ID && (
              <Animated.View entering={FadeInDown.delay(600).duration(400)}>
                <View style={styles.dividerContainer}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Or continue with</Text>
                  <View style={styles.dividerLine} />
                </View>
                <GoogleLoginButton />
              </Animated.View>
            )}

            <Animated.View entering={FadeInDown.delay(700).duration(400)}>
              <TouchableOpacity
                style={styles.forgotPasswordLink}
                onPress={() => navigation.navigate('ForgotPassword')}>
                <Text style={styles.forgotPasswordText}>Forgot your password?</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollContent: {
    flexGrow: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#059669',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 32,
    textAlign: 'center',
  },
  linkTextInline: {
    color: '#059669',
    fontWeight: '600',
  },
  form: {
    gap: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 16,
    fontSize: 16,
    color: '#111827',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    padding: 16,
    borderRadius: 12,
    gap: 8,
    minHeight: 52,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#D1D5DB',
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 14,
    color: '#6B7280',
    backgroundColor: '#F9FAFB',
  },
  forgotPasswordLink: {
    marginTop: 8,
    alignItems: 'center',
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '500',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#DC2626',
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  successText: {
    flex: 1,
    fontSize: 14,
    color: '#16A34A',
  },
});

