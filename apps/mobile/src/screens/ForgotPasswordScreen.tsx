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
import Icon from 'react-native-vector-icons/MaterialIcons';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';

type RootStackParamList = {
  Login: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

type Step = 'email' | 'otp' | 'reset';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showAlert = (title: string, message: string) => {
    Alert.alert(title, message);
  };

  const handleSendOTP = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setError(null);
    setSendingOtp(true);

    try {
      const res = await apiFetch('/auth/forgot-password/send-otp', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        let errorMessage = 'Failed to send OTP';
        try {
          const errorData = await res.json();
          const apiError = errorData.error || errorData.message;
          if (apiError) {
            if (apiError.includes('wait') || apiError.includes('rate limit') || res.status === 429) {
              errorMessage = 'Too many requests. Please wait a minute before requesting another OTP.';
            } else if (apiError.includes('not found') || apiError.includes('does not exist')) {
              errorMessage = 'No account found with this email address.';
            } else {
              errorMessage = apiError;
            }
          }
        } catch {
          if (res.status === 429) {
            errorMessage = 'Too many requests. Please wait a minute before requesting another OTP.';
          }
        }
        setError(errorMessage);
        showAlert('Error', errorMessage);
        return;
      }

      await res.text(); // Consume response
      showAlert('Success', 'OTP sent to your email!');
      setStep('otp');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send OTP. Please try again.';
      setError(errorMessage);
      showAlert('Error', errorMessage);
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otp.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/auth/forgot-password/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ email, otp }),
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
        showAlert('Error', errorMessage);
        return;
      }

      await res.text(); // Consume response
      showAlert('Success', 'OTP verified successfully!');
      setStep('reset');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid or expired OTP';
      setError(errorMessage);
      showAlert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newPassword.length < 6) {
      const errorMsg = 'Password must be at least 6 characters';
      setError(errorMsg);
      showAlert('Error', errorMsg);
      return;
    }

    if (newPassword !== confirmPassword) {
      const errorMsg = 'Passwords do not match';
      setError(errorMsg);
      showAlert('Error', errorMsg);
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await apiFetch('/auth/forgot-password/reset', {
        method: 'POST',
        body: JSON.stringify({
          email,
          otp,
          newPassword,
          confirmPassword,
        }),
      });

      if (!res.ok) {
        let errorMessage = 'Failed to reset password';
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // Use default message
        }
        setError(errorMessage);
        showAlert('Error', errorMessage);
        return;
      }

      await res.text(); // Consume response
      showAlert('Success', 'Password reset successfully! Redirecting to login...');
      setTimeout(() => {
        navigation.navigate('Login');
      }, 1500);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to reset password';
      setError(errorMessage);
      showAlert('Error', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderEmailStep = () => (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
      <View style={styles.inputContainer}>
        <Icon name="email" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Enter your email"
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

      <TouchableOpacity
        style={[styles.primaryButton, sendingOtp && styles.buttonDisabled]}
        onPress={handleSendOTP}
        disabled={sendingOtp}>
        {sendingOtp ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.primaryButtonText}>Send Verification Code</Text>
        )}
      </TouchableOpacity>
    </Animated.View>
  );

  const renderOTPStep = () => (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
      <View style={styles.otpContainer}>
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
        <Text style={styles.otpHint}>Enter the 6-digit code sent to {email}</Text>
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            setStep('email');
            setOtp('');
            setError(null);
          }}>
          <Icon name="arrow-back" size={20} color="#374151" style={styles.buttonIcon} />
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.primaryButton, (loading || otp.length !== 6) && styles.buttonDisabled]}
          onPress={handleVerifyOTP}
          disabled={loading || otp.length !== 6}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Verify Code</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  const renderResetStep = () => (
    <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOutUp.duration(200)}>
      <View style={styles.inputContainer}>
        <Icon name="lock" size={20} color="#9CA3AF" style={styles.inputIcon} />
        <TextInput
          style={styles.input}
          placeholder="Enter new password"
          value={newPassword}
          onChangeText={(text) => {
            setNewPassword(text);
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
          placeholder="Confirm new password"
          value={confirmPassword}
          onChangeText={(text) => {
            setConfirmPassword(text);
            setError(null);
          }}
          secureTextEntry
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={() => {
            setStep('otp');
            setNewPassword('');
            setConfirmPassword('');
            setError(null);
          }}>
          <Icon name="arrow-back" size={20} color="#374151" style={styles.buttonIcon} />
          <Text style={styles.secondaryButtonText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (loading || newPassword.length < 6 || newPassword !== confirmPassword) && styles.buttonDisabled,
          ]}
          onPress={handleResetPassword}
          disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}>
          {loading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryButtonText}>Reset Password</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.iconContainer}>
            <View style={styles.iconCircle}>
              <Icon name="lock" size={32} color="#FFFFFF" />
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).duration(400)}>
            <Text style={styles.title}>
              {step === 'email' && 'Forgot Password'}
              {step === 'otp' && 'Verify OTP'}
              {step === 'reset' && 'Reset Password'}
            </Text>
            <Text style={styles.subtitle}>
              {step === 'email' && "Enter your email address and we'll send you a verification code"}
              {step === 'otp' && 'Enter the verification code sent to your email'}
              {step === 'reset' && 'Enter your new password'}
            </Text>
          </Animated.View>

          {error && (
            <Animated.View entering={FadeInDown.duration(200)} style={styles.errorContainer}>
              <Icon name="error" size={20} color="#DC2626" />
              <Text style={styles.errorText}>{error}</Text>
            </Animated.View>
          )}

          <View style={styles.form}>
            {step === 'email' && renderEmailStep()}
            {step === 'otp' && renderOTPStep()}
            {step === 'reset' && renderResetStep()}
          </View>

          <TouchableOpacity
            style={styles.backLink}
            onPress={() => navigation.navigate('Login')}>
            <Icon name="arrow-back" size={16} color="#059669" />
            <Text style={styles.backLinkText}>Back to login</Text>
          </TouchableOpacity>
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
  otpHint: {
    marginTop: 12,
    fontSize: 12,
    color: '#6B7280',
    textAlign: 'center',
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
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 14,
    color: '#DC2626',
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
    gap: 6,
  },
  backLinkText: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '500',
  },
});

