-- StockMovementType.RETURN is declared in schema.prisma and written by returnService when
-- returned stock re-enters a store, but no migration added the value. Enum change only: the
-- new value is not used in this migration, so it is safe inside the migration transaction.
ALTER TYPE "StockMovementType" ADD VALUE IF NOT EXISTS 'RETURN';
