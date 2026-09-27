-- Migration: Delivery routing and per-order delivery economics
--
-- Adds the columns behind internal/fulfillment: how large/awkward a plant
-- is (which decides whether a courier can take it), and what each order
-- actually cost to deliver.
--
-- AutoMigrate creates these on boot when AUTO_MIGRATE=true; run this script
-- directly where it is off.

-- Product-level handling defaults.
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS size_class VARCHAR(16) DEFAULT 'small',
    ADD COLUMN IF NOT EXISTS bulky BOOLEAN DEFAULT FALSE;

UPDATE products SET size_class = 'small' WHERE size_class IS NULL OR size_class = '';

-- Per-size overrides. NULL means "inherit from the product", so these
-- intentionally have no default.
ALTER TABLE product_sizes
    ADD COLUMN IF NOT EXISTS size_class VARCHAR(16),
    ADD COLUMN IF NOT EXISTS bulky BOOLEAN;

-- Per-order fulfillment channel, distance and money breakdown. Existing
-- orders predate the rules: their amount is the subtotal and no channel is
-- known, which matches how the API records a legacy checkout.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS fulfillment_channel VARCHAR(32),
    ADD COLUMN IF NOT EXISTS fulfillment_zone VARCHAR(32),
    ADD COLUMN IF NOT EXISTS subtotal DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION DEFAULT 0,
    ADD COLUMN IF NOT EXISTS delivery_fee_waived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS distance_km DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS distance_source VARCHAR(16),
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS courier_provider VARCHAR(64),
    ADD COLUMN IF NOT EXISTS courier_service VARCHAR(128),
    ADD COLUMN IF NOT EXISTS courier_cost DOUBLE PRECISION;

UPDATE orders SET subtotal = amount WHERE subtotal = 0 AND amount > 0;

-- Channel is the main slice for delivery-cost reporting.
CREATE INDEX IF NOT EXISTS idx_orders_channel ON orders (fulfillment_channel);
