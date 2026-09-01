-- Speeds up product search, featured, related, and detail lookups.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_short_desc_trgm ON products USING gin (short_desc gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_products_tags_gin ON products USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_categories_name_trgm ON categories USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_brands_name_trgm ON brands USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_slug_alive ON products (slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_product_sizes_product_id ON product_sizes (product_id);
CREATE INDEX IF NOT EXISTS idx_attributes_product_id ON attributes (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product_id_created ON reviews (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_products_featured_created ON products (created_at DESC) WHERE featured = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_category_created ON products (category_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_created ON products (created_at DESC) WHERE deleted_at IS NULL;
