import { getFirestoreDB } from './firebase.js';
import { isOutletPortalMongoConnected } from '../outlet-portal/config/portalDb.js';
import { getOutletProductsModel } from '../outlet-portal/models/OutletProducts.js';
import { roundQty } from './quantities.js';

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const fetchProductCatalogByDocId = async (items) => {
  const db = getFirestoreDB();
  const docIds = [
    ...new Set(
      items
        .map((item) => (item?.productId != null ? String(item.productId).trim() : ''))
        .filter(Boolean)
    )
  ];
  if (docIds.length === 0) return new Map();

  const snapshots = await Promise.all(docIds.map((id) => db.collection('products').doc(id).get()));
  const catalogByDocId = new Map();
  docIds.forEach((id, index) => {
    const snap = snapshots[index];
    if (snap?.exists) {
      catalogByDocId.set(id, snap.data());
    }
  });
  return catalogByDocId;
};

const buildQuantityUpdatesFromItems = (items, catalogByDocId, sign = 1) => {
  const updates = new Map();

  for (const item of items) {
    const docId = item?.productId != null ? String(item.productId).trim() : '';
    const quantity = toFiniteNumber(item?.quantity, 0);
    if (!docId || quantity <= 0) continue;

    const catalog = catalogByDocId.get(docId);
    const mapKey = String(catalog?.productId || item?.prodid || docId).trim();
    if (!mapKey) continue;

    const quantityDelta = sign * quantity;
    const existing = updates.get(mapKey);
    if (existing) {
      existing.quantityDelta += quantityDelta;
      continue;
    }

    updates.set(mapKey, { quantityDelta, item, catalog: catalog || null });
  }

  return updates;
};

const syncOutletProductQuantityDeltas = async (outletId, quantityUpdates) => {
  if (!quantityUpdates || quantityUpdates.size === 0) {
    return;
  }

  const OutletProducts = getOutletProductsModel();
  const doc = await OutletProducts.findOne({ outletId });
  const productsMap =
    doc?.products && typeof doc.products === 'object' && !Array.isArray(doc.products)
      ? doc.products
      : {};

  for (const [mapKey, { quantityDelta, item, catalog }] of quantityUpdates.entries()) {
    const existing =
      productsMap[mapKey] && typeof productsMap[mapKey] === 'object' ? productsMap[mapKey] : null;

    if (quantityDelta < 0 && !existing) {
      continue;
    }

    const currentQuantity = toFiniteNumber(existing?.quantity, 0);
    const name = existing?.name || item?.name || catalog?.name || '';
    const category = existing?.category || catalog?.category || '';
    const unit = existing?.unit || catalog?.unit || '';
    const price =
      existing?.price != null && Number.isFinite(Number(existing.price)) && Number(existing.price) > 0
        ? Number(existing.price)
        : toFiniteNumber(item?.price ?? catalog?.price, 0);

    productsMap[mapKey] = {
      productId: mapKey,
      name: String(name),
      category: String(category),
      unit: String(unit),
      price,
      quantity: roundQty(Math.max(0, currentQuantity + quantityDelta))
    };
  }

  const updatedAt = new Date();
  const productCount = Object.keys(productsMap).length;

  if (!doc) {
    await OutletProducts.create({
      outletId,
      products: productsMap,
      productCount,
      updatedAt
    });
    return;
  }

  doc.products = productsMap;
  doc.productCount = productCount;
  doc.updatedAt = updatedAt;
  doc.markModified('products');
  await doc.save();
};

const applyOutletProductQuantityChange = async (outletId, items, sign) => {
  const safeOutletId = typeof outletId === 'string' ? outletId.trim() : '';
  if (!safeOutletId || !Array.isArray(items) || items.length === 0) {
    return;
  }

  if (!isOutletPortalMongoConnected()) {
    console.warn(
      `Skipping Products stock update for outlet ${safeOutletId}: outlet portal MongoDB not connected.`
    );
    return;
  }

  const catalogByDocId = await fetchProductCatalogByDocId(items);
  const quantityUpdates = buildQuantityUpdatesFromItems(items, catalogByDocId, sign);
  if (quantityUpdates.size === 0) {
    return;
  }

  await syncOutletProductQuantityDeltas(safeOutletId, quantityUpdates);
};

export const addDeliveredOrderItemsToOutletProducts = async (outletId, items) =>
  applyOutletProductQuantityChange(outletId, items, 1);

export const subtractCollectedReturnItemsFromOutletProducts = async (outletId, items) =>
  applyOutletProductQuantityChange(outletId, items, -1);
