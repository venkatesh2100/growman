import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { apiFetch } from '../lib/api';
import { useCartStore } from '../store/cartStore';

type RootStackParamList = {
  Main: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function CheckoutScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { items, getTotalPrice, clearCart } = useCartStore();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    if (!email || !name || !phone || !address || !city || !pincode) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    try {
      setLoading(true);
      const response = await apiFetch('/checkout/create-order', {
        method: 'POST',
        body: JSON.stringify({
          email,
          name,
          phone,
          address,
          city,
          pincode,
          items: items.map((item) => ({
            productId: item.productId,
            productSizeId: item.productSizeId,
            quantity: item.quantity,
          })),
        }),
      });

      if (response.ok) {
        const data = await response.json();
        clearCart();
        Alert.alert('Success', 'Order placed successfully!', [
          {
            text: 'OK',
            onPress: () => navigation.navigate('Main'),
          },
        ]);
      } else {
        const error = await response.json();
        Alert.alert('Error', error.message || 'Failed to place order');
      }
    } catch (error) {
      Alert.alert('Error', 'Failed to place order. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Shipping Details</Text>
        <TextInput
          style={styles.input}
          placeholder="Full Name"
          value={name}
          onChangeText={setName}
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          placeholder="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          placeholder="Address"
          value={address}
          onChangeText={setAddress}
          multiline
          numberOfLines={3}
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          placeholder="City"
          value={city}
          onChangeText={setCity}
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          placeholder="Pincode"
          value={pincode}
          onChangeText={setPincode}
          keyboardType="number-pad"
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Order Summary</Text>
        {items.map((item) => (
          <View key={item.id} style={styles.orderItem}>
            <Text style={styles.orderItemName}>{item.name}</Text>
            <Text style={styles.orderItemPrice}>
              ₹{item.price} x {item.quantity}
            </Text>
          </View>
        ))}
        <View style={styles.totalContainer}>
          <Text style={styles.totalLabel}>Total:</Text>
          <Text style={styles.totalPrice}>₹{getTotalPrice().toFixed(2)}</Text>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.checkoutButton, loading && styles.buttonDisabled]}
        onPress={handleCheckout}
        disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.checkoutText}>Place Order</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FBF7',
  },
  section: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 16,
  },
  input: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#111827',
    marginBottom: 12,
  },
  orderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  orderItemName: {
    fontSize: 16,
    color: '#374151',
    flex: 1,
  },
  orderItemPrice: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  totalContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 2,
    borderTopColor: '#E5E7EB',
  },
  totalLabel: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
  },
  totalPrice: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#059669',
  },
  checkoutButton: {
    backgroundColor: '#059669',
    padding: 16,
    margin: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  checkoutText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

