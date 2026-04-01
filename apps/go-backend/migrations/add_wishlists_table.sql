-- Add wishlists table (safe to run - only creates if not exists)
-- Run with: psql $DATABASE_URL -f migrations/add_wishlists_table.sql

CREATE TABLE IF NOT EXISTS wishlists (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    user_id BIGINT NOT NULL,
    product_id BIGINT NOT NULL,
    CONSTRAINT fk_wishlists_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_wishlists_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT idx_user_product UNIQUE (user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlists_deleted_at ON wishlists(deleted_at);
CREATE INDEX IF NOT EXISTS idx_wishlists_user_id ON wishlists(user_id);
