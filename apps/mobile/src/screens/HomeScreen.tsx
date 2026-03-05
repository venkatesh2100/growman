import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { apiFetch } from '../lib/api';
import { Product } from '../lib/types';
import ProductCard from '../components/ProductCard';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const { width } = Dimensions.get('window');

type RootStackParamList = {
  ProductDetail: { product: Product };
  Category: { categorySlug: string };
  Shop: undefined;
};

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

interface Category {
  id: number;
  name: string;
  slug: string;
  imageUrl?: string;
}

export default function HomeScreen() {
  const navigation = useNavigation<NavigationProp>();
  const [featuredProducts, setFeaturedProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      await Promise.all([loadFeaturedProducts(), loadCategories()]);
    } finally {
      setLoading(false);
    }
  };

  const loadFeaturedProducts = async () => {
    try {
      const response = await apiFetch('/products/featured');
      if (response.ok) {
        const data = await response.json();
        setFeaturedProducts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading featured products:', error);
    }
  };

  const loadCategories = async () => {
    try {
      const response = await apiFetch('/categories');
      if (response.ok) {
        const data = await response.json();
        setCategories(Array.isArray(data) ? data.slice(0, 6) : []);
      }
    } catch (error) {
      console.error('Error loading categories:', error);
    }
  };

  const renderCategoryCard = (category: Category, index: number) => (
    <Animated.View
      key={category.id}
      entering={FadeInDown.delay(index * 100).duration(400)}>
      <TouchableOpacity
        style={styles.categoryCard}
        onPress={() => navigation.navigate('Category', { categorySlug: category.slug })}>
        <View style={styles.categoryIconContainer}>
          <Icon name="local-florist" size={32} color="#059669" />
        </View>
        <Text style={styles.categoryName} numberOfLines={1}>
          {category.name}
        </Text>
      </TouchableOpacity>
    </Animated.View>
  );

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Hero Section */}
      <Animated.View entering={FadeInUp.duration(500)} style={styles.heroSection}>
        <View style={styles.heroContent}>
          <Text style={styles.heroTitle}>
            Bring Nature{'\n'}Into Your <Text style={styles.heroTitleAccent}>Home</Text>
          </Text>
          <Text style={styles.heroSubtitle}>
            Discover the perfect plants to transform your space. Our collection of
            hand-picked greenery will breathe life into your home.
          </Text>
          <TouchableOpacity
            style={styles.heroButton}
            onPress={() => navigation.navigate('Shop')}>
            <Text style={styles.heroButtonText}>Shop Plants</Text>
            <Icon name="arrow-forward" size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* Categories Section */}
      {categories.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Shop by Category</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Shop')}>
              <Text style={styles.seeAll}>See All</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoriesContainer}>
            {categories.map((category, index) => renderCategoryCard(category, index))}
          </ScrollView>
        </View>
      )}

      {/* Featured Products */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Featured Plants</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Shop')}>
            <Text style={styles.seeAll}>See All</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#059669" />
          </View>
        ) : featuredProducts.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.productsContainer}>
            {featuredProducts.map((product, index) => (
              <View key={product.id} style={styles.productWrapper}>
                <ProductCard
                  product={product}
                  onPress={() => navigation.navigate('ProductDetail', { product })}
                  index={index}
                />
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyContainer}>
            <Icon name="inventory-2" size={48} color="#D1D5DB" />
            <Text style={styles.emptyText}>No featured products available</Text>
          </View>
        )}
      </View>

      {/* Benefits Section */}
      <Animated.View entering={FadeInUp.delay(300).duration(400)} style={styles.benefitsSection}>
        <Text style={styles.benefitsTitle}>Why Choose Growman</Text>
        <Text style={styles.benefitsSubtitle}>
          We're passionate about helping you create a greener, healthier living space
        </Text>

        <View style={styles.benefitsGrid}>
          <View style={styles.benefitItem}>
            <View style={styles.benefitIconContainer}>
              <Icon name="verified" size={28} color="#059669" />
            </View>
            <Text style={styles.benefitTitle}>Quality Guaranteed</Text>
            <Text style={styles.benefitDescription}>
              Each plant is carefully selected and nurtured
            </Text>
          </View>

          <View style={styles.benefitItem}>
            <View style={styles.benefitIconContainer}>
              <Icon name="local-shipping" size={28} color="#059669" />
            </View>
            <Text style={styles.benefitTitle}>Nationwide Delivery</Text>
            <Text style={styles.benefitDescription}>
              We ship with care to anywhere in the country
            </Text>
          </View>

          <View style={styles.benefitItem}>
            <View style={styles.benefitIconContainer}>
              <Icon name="support-agent" size={28} color="#059669" />
            </View>
            <Text style={styles.benefitTitle}>Expert Advice</Text>
            <Text style={styles.benefitDescription}>
              Our specialists are available to help you
            </Text>
          </View>
        </View>
      </Animated.View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  heroSection: {
    backgroundColor: '#059669',
    paddingTop: 60,
    paddingBottom: 40,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 30,
    borderBottomRightRadius: 30,
  },
  heroContent: {
    maxWidth: width - 40,
  },
  heroTitle: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
    lineHeight: 44,
  },
  heroTitleAccent: {
    color: '#D1FAE5',
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#D1FAE5',
    marginBottom: 24,
    lineHeight: 24,
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 30,
    gap: 8,
  },
  heroButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#059669',
  },
  section: {
    marginTop: 32,
    paddingHorizontal: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#111827',
  },
  seeAll: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '600',
  },
  categoriesContainer: {
    paddingRight: 16,
    gap: 12,
  },
  categoryCard: {
    width: 100,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginRight: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  categoryIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  categoryName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111827',
    textAlign: 'center',
  },
  productsContainer: {
    paddingRight: 16,
  },
  productWrapper: {
    width: 180,
    marginRight: 12,
  },
  loaderContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6B7280',
    marginTop: 12,
  },
  benefitsSection: {
    backgroundColor: '#FFFFFF',
    marginTop: 32,
    marginHorizontal: 16,
    marginBottom: 32,
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  benefitsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
    textAlign: 'center',
  },
  benefitsSubtitle: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 24,
    textAlign: 'center',
  },
  benefitsGrid: {
    gap: 20,
  },
  benefitItem: {
    alignItems: 'center',
  },
  benefitIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#D1FAE5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  benefitTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 4,
  },
  benefitDescription: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
  },
});
