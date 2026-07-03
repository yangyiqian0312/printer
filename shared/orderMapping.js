export function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;

  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function expandNestedJson(value, depth = 0) {
  if (depth > 4) return value;

  const parsed = parseMaybeJson(value);

  if (Array.isArray(parsed)) {
    return parsed.map((item) => expandNestedJson(item, depth + 1));
  }

  if (parsed && typeof parsed === 'object') {
    return Object.fromEntries(
      Object.entries(parsed).map(([key, entry]) => [key, expandNestedJson(entry, depth + 1)])
    );
  }

  return parsed;
}

export function findDeepValue(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const queue = [value];
  const seen = new Set();

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') continue;
    if (seen.has(current)) continue;
    seen.add(current);

    for (const [key, entry] of Object.entries(current)) {
      if (wanted.has(key.toLowerCase()) && entry !== undefined && entry !== null && String(entry).trim()) {
        return entry;
      }

      if (entry && typeof entry === 'object') queue.push(entry);
    }
  }

  return undefined;
}

export function normalizeOrder(body) {
  const expanded = expandNestedJson(body);
  const orderId =
    expanded?.orderId ??
    expanded?.order_id ??
    expanded?.id ??
    findDeepValue(expanded, [
      'orderId',
      'order_id',
      'order_id_str',
      'order_sn',
      'orderNo',
      'order_no',
      'orderNumber',
      'order_number'
    ]);
  const buyerUsername =
    expanded?.buyerUsername ??
    expanded?.buyer_username ??
    expanded?.buyer?.username ??
    expanded?.recipient_address?.name ??
    findDeepValue(expanded, [
      'buyerUsername',
      'buyer_username',
      'buyer_user_name',
      'username',
      'user_name',
      'buyer_id',
      'buyerId',
      'recipient_name',
      'recipientName',
      'name'
    ]);

  if (!orderId || !buyerUsername) {
    const error = new Error('Missing orderId or buyerUsername');
    error.statusCode = 400;
    throw error;
  }

  return {
    orderId: String(orderId).trim(),
    buyerUsername: String(buyerUsername).trim()
  };
}
