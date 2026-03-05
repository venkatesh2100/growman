import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Image,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { useCartStore } from '../store/cartStore';
import { Product } from '../lib/types';

type RootStackParamList = {
  ProductDetail: { product: Product };
};

type ProductDetailRouteProp = RouteProp<RootStackParamList, 'ProductDetail'>;

export default function ProductDetailScreen() {
  const route = useRoute<ProductDetailRouteProp>();
  const { product } = route.params;
  const { addItem } = useCartStore();
  const [selectedSize, setSelectedSize] = useState(product.sizes[0]);

  const handleAddToCart = () => {
    if (!selectedSize) {
      Alert.alert('Error', 'Please select a size');
      return;
    }

    addItem({
      productId: product.id,
      productSizeId: selectedSize.id,
      name: product.name,
      price: selectedSize.price,
      mrp: product.mrp,
      quantity: 1,
      image: product.imageUrl || '',
      label: selectedSize.label,
      dimension: selectedSize.dimension,
    });

    Alert.alert('Success', 'Product added to cart');
  };

  return (
    <ScrollView style={styles.container}>
      <Image
        source={{ uri: product.imageUrl || 'https://via.placeholder.com/400' }}
        style={styles.productImage}
        resizeMode="cover"
      />

      <View style={styles.content}>
        <Text style={styles.productName}>{product.name}</Text>

        <View style={styles.priceContainer}>
          <Text style={styles.price}>₹{selectedSize?.price || product.price}</Text>
          {product.mrp && product.mrp > (selectedSize?.price || product.price) && (
            <Text style={styles.mrp}>₹{product.mrp}</Text>
          )}
        </View>

        {product.description && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{product.description}</Text>
          </View>
        )}

        {product.sizes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Available Sizes</Text>
            <View style={styles.sizesContainer}>
              {product.sizes.map((size) => (
                <TouchableOpacity
                  key={size.id}
                  style={[
                    styles.sizeButton,
                    selectedSize?.id === size.id && styles.sizeButtonSelected,
                  ]}
                  onPress={() => setSelectedSize(size)}>
                  <Text
                    style={[
                      styles.sizeText,
                      selectedSize?.id === size.id && styles.sizeTextSelected,
                    ]}>
                    {size.label}
                  </Text>
                  <Text
                    style={[
                      styles.sizePrice,
                      selectedSize?.id === size.id && styles.sizePriceSelected,
                    ]}>
                    ₹{size.price}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {product.attributes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Specifications</Text>
            {product.attributes.map((attr) => (
              <View key={attr.id} style={styles.attributeRow}>
                <Text style={styles.attributeName}>{attr.name}:</Text>
                <Text style={styles.attributeValue}>{attr.value}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.addToCartButton} onPress={handleAddToCart}>
          <Icon name="shopping-cart" size={24} color="#FFFFFF" />
          <Text style={styles.addToCartText}>Add to Cart</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FBF7',
  },
  productImage: {
    width: '100%',
    height: 400,
    backgroundColor: '#F3F4F6',
  },
  content: {
    padding: 16,
  },
  productName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 12,
  },
  priceContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 24,
  },
  price: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#059669',
  },
  mrp: {
    fontSize: 20,
    color: '#9CA3AF',
    textDecorationLine: 'line-through',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  description: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
  },
  sizesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sizeButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
  },
  sizeButtonSelected: {
    borderColor: '#059669',
    backgroundColor: '#D1FAE5',
  },
  sizeText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  sizeTextSelected: {
    color: '#059669',
  },
  sizePrice: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  sizePriceSelected: {
    color: '#059669',
  },
  attributeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  attributeName: {
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
  },
  attributeValue: {
    fontSize: 16,
    color: '#111827',
  },
  addToCartButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    padding: 16,
    borderRadius: 12,
    gap: 8,
    marginTop: 8,
  },
  addToCartText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

