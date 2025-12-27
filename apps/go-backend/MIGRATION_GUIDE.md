# Database Migration Guide

## Quick Fix: Add Missing Columns

If you're getting the error `column "image_key" of relation "products" does not exist`, run this SQL script:

```bash
# Option 1: Run the SQL script directly
psql $DATABASE_URL -f migrations/add_image_key_columns.sql

# Option 2: Copy and paste the SQL into your database client
```

Or run the SQL directly in your database:

```sql
-- Add image_key column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS image_key VARCHAR(255) DEFAULT '';

-- Add image_keys column to product_sizes table  
ALTER TABLE product_sizes ADD COLUMN IF NOT EXISTS image_keys TEXT[] DEFAULT '{}';

-- Add image_key column to order_items table
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS image_key VARCHAR(255) DEFAULT '';
```

## Automatic Migration

The migration should run automatically when you start the server if `AUTO_MIGRATE=true` is set in your `.env` file.

To run migrations manually:

```bash
cd apps/go-backend
go run ./cmd/migrate
```

## Migrating Existing Data

If you have existing products with `image_url` values, you can migrate them:

```sql
-- Extract image keys from existing URLs (adjust pattern based on your URL structure)
UPDATE products 
SET image_key = SUBSTRING(image_url FROM 'images/(.*)')
WHERE image_url IS NOT NULL AND image_url != '' AND image_key = '';
```

## Verifying Migration

Check that columns were added:

```sql
-- Check products table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'products' AND column_name LIKE 'image%';

-- Check product_sizes table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'product_sizes' AND column_name LIKE 'image%';

-- Check order_items table
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'order_items' AND column_name LIKE 'image%';
```

