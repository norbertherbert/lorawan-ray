export const emptyReceptionFilters = Object.freeze({
  from: '',
  to: '',
  gatewayId: '',
  devAddr: '',
});

export function normalizeReceptionFilters(filters) {
  return {
    from: filters.from?.trim() || '',
    to: filters.to?.trim() || '',
    gatewayId: normalizeHexIdentifier(filters.gatewayId),
    devAddr: normalizeHexIdentifier(filters.devAddr),
  };
}

function normalizeHexIdentifier(value) {
  return value.trim().replace(/[:\s-]/g, '').toUpperCase();
}

/** Builds a parameterized page query using only predicates selected by application code. */
export function buildReceptionPageQuery({ page, pageSize, filters }) {
  const predicates = [];
  const variables = {
    limit: pageSize + 1,
    start: page * pageSize,
  };

  if (filters.from) {
    predicates.push('gateway.ingested_at >= $from');
    variables.from = parseLocalDateTime(filters.from);
  }
  if (filters.to) {
    predicates.push('gateway.ingested_at <= $to');
    variables.to = parseLocalDateTime(filters.to, { endOfDay: true });
  }
  if (filters.gatewayId) {
    predicates.push(
      '(gateway.gateway_id = $gateway_id OR gateway.gateway_id = $legacy_gateway_id)',
    );
    variables.gateway_id = filters.gatewayId;
    variables.legacy_gateway_id = colonSeparatedGatewayId(filters.gatewayId);
  }
  if (filters.devAddr) {
    predicates.push('lorawan.dev_addr = $dev_addr');
    variables.dev_addr = filters.devAddr;
  }

  const where = predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
  return {
    text: `
      SELECT *
      FROM gateway_rxpk
      ${where}
      ORDER BY gateway.ingested_at DESC
      LIMIT $limit START $start
    `,
    variables,
  };
}

function colonSeparatedGatewayId(value) {
  return /^[0-9A-F]{16}$/.test(value) ? value.match(/.{2}/g).join(':') : value;
}

/** Parses the ISO-like filter display without relying on implementation-specific Date parsing. */
export function parseLocalDateTime(value, { endOfDay = false } = {}) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!match) throw new Error(`Invalid date and time: ${value}`);

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hasTime = hourText !== undefined;
  const hour = hasTime ? Number(hourText) : endOfDay ? 23 : 0;
  const minute = hasTime ? Number(minuteText) : endOfDay ? 59 : 0;
  const second = hasTime ? Number(secondText || 0) : endOfDay ? 59 : 0;
  const millisecond = !hasTime && endOfDay ? 999 : 0;
  const date = new Date(year, month, day, hour, minute, second, millisecond);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    throw new Error(`Invalid date and time: ${value}`);
  }

  return date;
}
