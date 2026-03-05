import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiFetch, searchProducts } from '../lib/api';
import { Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import Animated, { FadeInDown } from 'react-native-reanimated';

type RootStackParamList = {
  ProductDetail: { product: Product };
  Category: { categorySlug: string };
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

export default function ShopScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [sortBy, setSortBy] = useState<'name' | 'price' | 'newest'>('newest');

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch(searchQuery);
      } else {
        loadProducts();
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const loadProducts = async () => {
    try {
      setLoading(true);
      const response = await apiFetch('/products?page=1&pageSize=50');
      if (response.ok) {
        const data = await response.json();
        const productsList = Array.isArray(data) ? data : data.data || [];
        setProducts(sortProducts(productsList));
      }
    } catch (error) {
      console.error('Error loading products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      loadProducts();
      return;
    }

    try {
      setSearching(true);
      const result = await searchProducts(query);
      setProducts(sortProducts(result.data));
    } catch (error) {
      console.error('Error searching products:', error);
    } finally {
      setSearching(false);
    }
  };

  const sortProducts = (productsList: Product[]): Product[] => {
    const sorted = [...productsList];
    switch (sortBy) {
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      case 'price':
        return sorted.sort((a, b) => a.price - b.price);
      case 'newest':
      default:
        return sorted;
    }
  };

  const handleSortChange = (newSort: 'name' | 'price' | 'newest') => {
    setSortBy(newSort);
    setProducts(sortProducts(products));
    setShowFilters(false);
  };

  const renderProduct = ({ item, index }: { item: Product; index: number }) => (
    <View style={styles.productWrapper}>
      <ProductCard
        product={item}
        onPress={() => navigation.navigate('ProductDetail', { product: item })}
        index={index}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Search and Filter Bar */}
      <View style={styles.searchBar}>
        <View style={styles.searchContainer}>
          <Icon name="search" size={22} color="#6B7280" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for plants..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor="#9CA3AF"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close" size={22} color="#6B7280" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={() => setShowFilters(true)}>
          <Icon name="tune" size={24} color="#059669" />
        </TouchableOpacity>
      </View>

      {/* Results Count */}
      {!loading && !searching && (
        <View style={styles.resultsContainer}>
          <Text style={styles.resultsText}>
            {products.length} {products.length === 1 ? 'product' : 'products'} found
          </Text>
        </View>
      )}

      {/* Products List */}
      {loading || searching ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : products.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Icon name="inventory-2" size={64} color="#D1D5DB" />
          <Text style={styles.emptyText}>No products found</Text>
          <Text style={styles.emptySubtext}>
            {searchQuery ? 'Try a different search term' : 'Check back later for new products'}
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
        />
      )}

      {/* Filter Modal */}
      <Modal
        visible={showFilters}
        transparent
        animationType="slide"
        onRequestClose={() => setShowFilters(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sort By</Text>
              <TouchableOpacity onPress={() => setShowFilters(false)}>
                <Icon name="close" size={24} color="#111827" />
              </TouchableOpacity>
            </View>
            <View style={styles.sortOptions}>
              <TouchableOpacity
                style={[styles.sortOption, sortBy === 'newest' && styles.sortOptionActive]}
                onPress={() => handleSortChange('newest')}>
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === 'newest' && styles.sortOptionTextActive,
                  ]}>
                  Newest First
                </Text>
                {sortBy === 'newest' && (
                  <Icon name="check" size={20} color="#059669" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortOption, sortBy === 'name' && styles.sortOptionActive]}
                onPress={() => handleSortChange('name')}>
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === 'name' && styles.sortOptionTextActive,
                  ]}>
                  Name (A-Z)
                </Text>
                {sortBy === 'name' && (
                  <Icon name="check" size={20} color="#059669" />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortOption, sortBy === 'price' && styles.sortOptionActive]}
                onPress={() => handleSortChange('price')}>
                <Text
                  style={[
                    styles.sortOptionText,
                    sortBy === 'price' && styles.sortOptionTextActive,
                  ]}>
                  Price (Low to High)
                </Text>
                {sortBy === 'price' && (
                  <Icon name="check" size={20} color="#059669" />
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  searchBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    gap: 12,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  searchIcon: {
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
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
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '50%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#111827',
  },
  sortOptions: {
    gap: 12,
  },
  sortOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
  },
  sortOptionActive: {
    backgroundColor: '#D1FAE5',
    borderWidth: 2,
    borderColor: '#059669',
  },
  sortOptionText: {
    fontSize: 16,
    color: '#111827',
    fontWeight: '500',
  },
  sortOptionTextActive: {
    color: '#059669',
    fontWeight: '600',
  },
});
