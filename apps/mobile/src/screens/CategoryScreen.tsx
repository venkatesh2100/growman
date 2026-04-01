import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { RouteProp, useRoute, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiFetch } from '../lib/api';
import { Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import Animated, { FadeInDown } from 'react-native-reanimated';

type RootStackParamList = {
  Category: { categorySlug: string };
  ProductDetail: { product: Product };
};

type CategoryRouteProp = RouteProp<RootStackParamList, 'Category'>;
type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface Subcategory {
  id: number;
  name: string;
  slug: string;
}

export default function CategoryScreen() {
  const route = useRoute<CategoryRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { categorySlug } = route.params;
  const [products, setProducts] = useState<Product[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState('');

  useEffect(() => {
    loadCategoryData();
  }, [categorySlug]);

  useEffect(() => {
    if (selectedSubcategory) {
      loadSubcategoryProducts(selectedSubcategory);
    } else {
      loadCategoryProducts();
    }
  }, [selectedSubcategory, categorySlug]);

  const loadCategoryData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadCategoryInfo(), loadSubcategories(), loadCategoryProducts()]);
    } finally {
      setLoading(false);
    }
  };

  const loadCategoryInfo = async () => {
    try {
      const response = await apiFetch(`/categories/${categorySlug}`);
      if (response.ok) {
        const data = await response.json();
        setCategoryName(data.name || categorySlug);
      }
    } catch (error) {
      console.error('Error loading category info:', error);
    }
  };

  const loadSubcategories = async () => {
    try {
      const response = await apiFetch(`/categories/${categorySlug}/subcategories`);
      if (response.ok) {
        const data = await response.json();
        setSubcategories(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading subcategories:', error);
    }
  };

  const loadCategoryProducts = async () => {
    try {
      const response = await apiFetch(
        `/categories/${categorySlug}/products?page=1&pageSize=50`
      );
      if (response.ok) {
        const data = await response.json();
        setProducts(Array.isArray(data) ? data : data.data || []);
      }
    } catch (error) {
      console.error('Error loading category products:', error);
    }
  };

  const loadSubcategoryProducts = async (subSlug: string) => {
    try {
      setLoading(true);
      const response = await apiFetch(
        `/categories/${categorySlug}/subcategories/${subSlug}/products?page=1&pageSize=50`
      );
      if (response.ok) {
        const data = await response.json();
        setProducts(Array.isArray(data) ? data : data.data || []);
      }
    } catch (error) {
      console.error('Error loading subcategory products:', error);
    } finally {
      setLoading(false);
    }
  };

  const renderSubcategory = (subcategory: Subcategory, index: number) => (
    <Animated.View
      key={subcategory.id}
      entering={FadeInDown.delay(index * 50).duration(300)}>
      <TouchableOpacity
        style={[
          styles.subcategoryChip,
          selectedSubcategory === subcategory.slug && styles.subcategoryChipActive,
        ]}
        onPress={() =>
          setSelectedSubcategory(
            selectedSubcategory === subcategory.slug ? null : subcategory.slug
          )
        }>
        <Text
          style={[
            styles.subcategoryText,
            selectedSubcategory === subcategory.slug && styles.subcategoryTextActive,
          ]}>
          {subcategory.name}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );

  const renderProduct = ({ item, index }: { item: Product; index: number }) => (
    <View style={styles.productWrapper}>
      <ProductCard
        product={item}
        onPress={() => navigation.navigate('ProductDetail', { product: item })}
        index={index}
      />
    </View>
  );

  if (loading && products.length === 0) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Subcategories Filter */}
      {subcategories.length > 0 && (
        <View style={styles.subcategoriesContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.subcategoriesContent}>
            <TouchableOpacity
              style={[
                styles.subcategoryChip,
                selectedSubcategory === null && styles.subcategoryChipActive,
              ]}
              onPress={() => setSelectedSubcategory(null)}>
              <Text
                style={[
                  styles.subcategoryText,
                  selectedSubcategory === null && styles.subcategoryTextActive,
                ]}>
                All
              </Text>
            </TouchableOpacity>
            {subcategories.map((subcategory, index) => renderSubcategory(subcategory, index))}
          </ScrollView>
        </View>
      )}

      {/* Products Count */}
      {!loading && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsText}>
            {products.length} {products.length === 1 ? 'product' : 'products'} found
          </Text>
        </View>
      )}

      {/* Products List */}
      {products.length === 0 && !loading ? (
        <View style={styles.emptyContainer}>
          <Icon name="inventory-2" size={64} color="#D1D5DB" />
          <Text style={styles.emptyText}>No products found</Text>
          <Text style={styles.emptySubtext}>
            {selectedSubcategory
              ? 'Try selecting a different subcategory'
              : 'Check back later for new products'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={products}
          renderItem={renderProduct}
          keyExtractor={(item) => item.id.toString()}
          numColumns={2}
          contentContainerStyle={styles.listContainer}
          columnWrapperStyle={styles.row}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={loadCategoryData}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  subcategoriesContainer: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  subcategoriesContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  subcategoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    marginRight: 8,
  },
  subcategoryChipActive: {
    backgroundColor: '#059669',
  },
  subcategoryText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  subcategoryTextActive: {
    color: '#FFFFFF',
  },
  resultsContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  resultsText: {
    fontSize: 14,
    color: '#6B7280',
  },
  listContainer: {
    padding: 8,
  },
  row: {
    justifyContent: 'space-between',
    paddingHorizontal: 8,
  },
  productWrapper: {
    width: '48%',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 8,
    textAlign: 'center',
  },
});
