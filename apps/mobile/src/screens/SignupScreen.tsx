import React, { useState, useEffect } from 'react';
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
import GoogleSignupButton from '../components/GoogleSignupButton';
import { GOOGLE_CLIENT_ID } from '../config/env';

type RootStackParamList = {
  Login: undefined;
  Main: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function SignupScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { setToken } = useAuthStore();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const validateForm = (): boolean => {
    if (!formData.name.trim()) {
      setError('Name is required');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!formData.email.trim() || !emailRegex.test(formData.email)) {
      setError('Valid email is required');
      return false;
    }
    const phoneRegex = /^[6-9][0-9]{9}$/;
    if (!formData.phone.trim() || !phoneRegex.test(formData.phone)) {
      setError('Valid 10-digit phone number is required (starting with 6-9)');
      return false;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSendOTP = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch('/checkout/send-email-otp', {
        method: 'POST',
        body: JSON.stringify({ email: formData.email }),
      });

      if (!res.ok) {
        let errorMessage = 'Failed to send OTP';
        try {
          const errorData = await res.json();
          const apiError = errorData.error || errorData.message;
          if (apiError) {
            if (apiError.includes('wait') || apiError.includes('rate limit') || res.status === 429) {
              errorMessage = 'Too many requests. Please wait a minute before requesting another OTP.';
              const retryAfter = errorData.retry_after || 60;
              setCooldown(retryAfter);
            } else {
              errorMessage = apiError;
            }
          }
        } catch {
          if (res.status === 429) {
            errorMessage = 'Too many requests. Please wait a minute before requesting another OTP.';
            setCooldown(60);
          }
        }
        setError(errorMessage);
        Alert.alert('Error', errorMessage);
        return;
      }

      await res.text(); // Consume response
      Alert.alert('Success', 'Verification code sent to your email!');
      setOtpSent(true);
      setCooldown(60);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to send verification email. Please try again.';
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp.trim() || otp.length !== 6) {
      setError('Please enter a valid 6-digit OTP');
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setVerifyingOtp(true);
    setError(null);

    try {
      const res = await apiFetch('/checkout/verify-email-otp', {
        method: 'POST',
        body: JSON.stringify({ email: formData.email, otp }),
      });

      if (!res.ok) {
        let errorMessage = 'Invalid OTP';
        try {
          const errorData = await res.json();
          const apiError = errorData.error || errorData.message;
          if (apiError) {
            if (apiError.includes('expired')) {
              errorMessage = 'OTP has expired. Please request a new one.';
            } else if (apiError.includes('invalid') || apiError.includes('incorrect')) {
              errorMessage = 'Invalid OTP. Please check and try again.';
            } else {
              errorMessage = apiError;
            }
          }
        } catch {
          // Use default message
        }
        setError(errorMessage);
        Alert.alert('Error', errorMessage);
        return;
      }

      await res.text(); // Consume response
      Alert.alert('Success', 'Email verified successfully!');
      setEmailVerified(true);
      // Proceed with signup
      await handleSignup();
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid OTP. Please try again.';
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleSignup = async () => {
    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
        }),
      });

      if (!res.ok) {
        let errorMessage = 'Signup failed';
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // Use default message
        }
        setError(errorMessage);
        Alert.alert('Signup Failed', errorMessage);
        return;
      }

      const data = await res.json();
      setToken(data.token);
      Alert.alert('Success', 'Account created successfully! Welcome!');
      setSuccess(true);
      // Navigation will automatically switch to Main stack
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Signup failed. Please try again.';
      setError(errorMsg);
      Alert.alert('Error', errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const renderFormFields = () => (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
      <View style={styles.inputContainer}>
        <Icon name="person" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Full Name"
          value={formData.name}
          onChangeText={(text) => {
            setFormData({ ...formData, name: text });
            setError(null);
          }}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Icon name="email" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={formData.email}
          onChangeText={(text) => {
            setFormData({ ...formData, email: text });
            setError(null);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Icon name="phone" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Phone (10 digits)"
          value={formData.phone}
          onChangeText={(text) => {
            setFormData({ ...formData, phone: text.replace(/\D/g, '').slice(0, 10) });
            setError(null);
          }}
          keyboardType="phone-pad"
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Icon name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Password"
          value={formData.password}
          onChangeText={(text) => {
            setFormData({ ...formData, password: text });
            setError(null);
          }}
          secureTextEntry
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.inputContainer}>
        <Icon name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Confirm Password"
          value={formData.confirmPassword}
          onChangeText={(text) => {
            setFormData({ ...formData, confirmPassword: text });
            setError(null);
          }}
          secureTextEntry
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <TouchableOpacity
        style={[styles.primaryButton, loading && styles.buttonDisabled]}
        onPress={handleSendOTP}
        disabled={loading || cooldown > 0}>
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>
            {cooldown > 0 ? `Resend OTP (${cooldown}s)` : 'Send Verification Code'}
          </Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );

  const renderOTPVerification = () => (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
      <View style={styles.otpContainer}>
        <Text style={styles.otpLabel}>Enter the 6-digit code sent to {formData.email}</Text>
        <TextInput
          style={styles.otpInput}
          placeholder="000000"
          value={otp}
          onChangeText={(text) => {
            setOtp(text.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          keyboardType="number-pad"
          maxLength={6}
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            setOtpSent(false);
            setOtp('');
            setError(null);
          }}>
          <Icon name="arrow-back" size={20} color="#374151" style={styles.buttonIcon} />
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, (verifyingOtp || otp.length !== 6) && styles.buttonDisabled]}
          onPress={handleVerifyOTP}
          disabled={verifyingOtp || otp.length !== 6}>
          {verifyingOtp ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Verify Code</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

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
              <Icon name="person-add" size={32} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <Text style={styles.title}>Create your account</Text>
            <Text style={styles.subtitle}>
              Already have an account?{' '}
              <Text style={styles.linkTextInline} onPress={() => navigation.navigate('Login')}>
                Sign in
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
                <Text style={styles.successText}>Account created successfully! Redirecting...</Text>
              </Animated.View>
            )}

            {!otpSent ? renderFormFields() : renderOTPVerification()}

            {GOOGLE_CLIENT_ID && !otpSent && (
              <Animated.View entering={FadeInDown.delay(600).duration(400)}>
                <View style={styles.dividerContainer}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>Or continue with</Text>
                  <View style={styles.dividerLine} />
                </View>
                <GoogleSignupButton />
              </Animated.View>
            )}
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
  otpContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  otpLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 16,
    textAlign: 'center',
  },
  otpInput: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 20,
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 8,
    textAlign: 'center',
    color: '#111827',
  },
  primaryButton: {
    backgroundColor: '#059669',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  buttonIcon: {
    marginRight: 4,
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
