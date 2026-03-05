import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialIcons';

export interface Toast {
  id: string;
  message: string;
  type?: 'success' | 'error' | 'info';
}

let toastIdCounter = 0;
const listeners: Array<(toasts: Toast[]) => void> = [];
let toasts: Toast[] = [];

function notify() {
  listeners.forEach((listener) => listener([...toasts]));
}

export function toast(message: string, type: 'success' | 'error' | 'info' = 'success') {
  const id = `toast-${++toastIdCounter}`;
  toasts.push({ id, message, type });
  notify();

  // Auto remove after 3 seconds
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, 3000);
}

export function useToast() {
  const [toastList, setToastList] = useState<Toast[]>([]);

  useEffect(() => {
    const listener = (newToasts: Toast[]) => {
      setToastList(newToasts);
    };
    listeners.push(listener);
    setToastList([...toasts]);

    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, []);

  return toastList;
}

export function ToastContainer() {
  const toastList = useToast();

  if (toastList.length === 0) return null;

  const removeToast = (id: string) => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  };

  return (
    <View style={styles.container}>
      {toastList.map((toastItem) => (
        <ToastItem key={toastItem.id} toast={toastItem} onRemove={removeToast} />
      ))}
    </View>
  );
}

function ToastItem({ toast: toastItem, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const slideAnim = React.useRef(new Animated.Value(-100)).current;
  const opacityAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 50,
        friction: 7,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleRemove = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onRemove(toastItem.id);
    });
  };

  const getIcon = () => {
    switch (toastItem.type) {
      case 'success':
        return 'check-circle';
      case 'error':
        return 'error';
      case 'info':
        return 'info';
      default:
        return 'check-circle';
    }
  };

  const getColor = () => {
    switch (toastItem.type) {
      case 'success':
        return '#10B981';
      case 'error':
        return '#EF4444';
      case 'info':
        return '#3B82F6';
      default:
        return '#10B981';
    }
  };

  return (
    <Animated.View
      style={[
        styles.toast,
        {
          backgroundColor: getColor(),
          transform: [{ translateX: slideAnim }],
          opacity: opacityAnim,
        },
      ]}>
      <Icon name={getIcon()} size={20} color="#FFFFFF" style={styles.icon} />
      <Text style={styles.message} numberOfLines={2}>
        {toastItem.message}
      </Text>
      <TouchableOpacity onPress={handleRemove} style={styles.closeButton}>
        <Icon name="close" size={18} color="#FFFFFF" />
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 16,
    left: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  icon: {
    marginRight: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  closeButton: {
    marginLeft: 12,
    padding: 4,
  },
});

