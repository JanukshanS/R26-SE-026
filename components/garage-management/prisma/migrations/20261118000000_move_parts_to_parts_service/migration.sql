-- Parts shops, their catalogues and garage part orders moved to the
-- parts-management service (its own schema, "parts"). Nothing here used them
-- in production yet, so the tables go rather than being copied across.

DROP TABLE IF EXISTS "part_order_items";
DROP TABLE IF EXISTS "part_orders";
DROP TABLE IF EXISTS "garage_sellers";
DROP TABLE IF EXISTS "seller_listings";
DROP TABLE IF EXISTS "part_sellers";

DROP TYPE IF EXISTS "PartOrderStatus";
DROP TYPE IF EXISTS "Fulfilment";
DROP TYPE IF EXISTS "PickupBy";
