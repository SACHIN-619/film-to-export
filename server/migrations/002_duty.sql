-- Duties-included (DDP) checkout: the order total = goods + estimated US import duty.
ALTER TABLE orders ADD COLUMN goods_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN duty_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN duty_basis TEXT;
-- Orders placed before this migration were goods-only.
UPDATE orders SET goods_cents = amount_cents WHERE goods_cents = 0;
