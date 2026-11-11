const warned = new Set();

export function isMissingIndexError(error) {
  const code = error?.code;
  const message = String(error?.message || '');
  return code === 9 || code === 'failed-precondition' || /index/i.test(message);
}

export function warnMissingIndex(label, error) {
  if (warned.has(label)) return;
  warned.add(label);
  console.warn(`${label} is waiting for a Firestore index. This list is still using the previous read.`);
  const url = String(error?.message || '').match(/https:\/\/\S+/);
  if (url) console.warn(url[0]);
}

export async function readPage(query, { orderField, direction = 'desc', start = 0, limit = 10 }) {
  const counted = await query.count().get();
  let paged = query.orderBy(orderField, direction === 'asc' ? 'asc' : 'desc');
  if (start > 0) paged = paged.offset(start);
  const snapshot = await paged.limit(limit).get();
  return {
    total: counted.data().count,
    docs: snapshot.docs,
  };
}
