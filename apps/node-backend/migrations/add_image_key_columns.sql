-- Migration: Add image_key columns for storage-agnostic image handling
-- Run this SQL script on your database to add the required columns

-- Add image_key column to products table (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'products' AND column_name = 'image_key'
    ) THEN
        ALTER TABLE products ADD COLUMN image_key VARCHAR(255) DEFAULT '';
    END IF;
END $$;

-- Add image_keys column to product_sizes table (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'product_sizes' AND column_name = 'image_keys'
    ) THEN
        ALTER TABLE product_sizes ADD COLUMN image_keys TEXT[] DEFAULT '{}';
    END IF;
END $$;

-- Add image_key column to order_items table (if it doesn't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'order_items' AND column_name = 'image_key'
    ) THEN
        ALTER TABLE order_items ADD COLUMN image_key VARCHAR(255) DEFAULT '';
    END IF;
END $$;

-- Optional: Migrate existing image_url data to image_key (if image_url column exists)
-- Uncomment the following if you have existing image_url data to migrate:
-- UPDATE products 
-- SET image_key = SUBSTRING(image_url FROM 'images/(.*)')
-- WHERE image_url IS NOT NULL AND image_url != '' AND image_key = '';

-- Optional: Remove old image_url column after migration (uncomment when ready)
-- ALTER TABLE products DROP COLUMN IF EXISTS image_url;
-- ALTER TABLE product_sizes DROP COLUMN IF EXISTS images;
-- ALTER TABLE order_items DROP COLUMN IF EXISTS image_url;

