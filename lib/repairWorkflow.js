const WAIT_STATUSES = ['รออะไหล่', 'ขอหยุดเครื่อง'];

function parseThaiDateTime(str) {
  if (!str) return null;
  const [datePart, timePart] = String(str).split(',').map(value => value.trim());
  const [day, month, rawYear] = (datePart || '').split('/').map(Number);
  if (!day || !month || !rawYear) return null;
  const year = rawYear > 2400 ? rawYear - 543 : rawYear;
  const [hour = 0, minute = 0, second = 0] = (timePart || '00:00:00').split(':').map(Number);
  const date = new Date(year, month - 1, day, hour || 0, minute || 0, second || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function buildWaitUpdateData(sheetRow, currentStatus, newStatus, waitStartRaw, waitMinutesRaw, now = new Date()) {
  const wasWaiting = WAIT_STATUSES.includes(currentStatus);
  const isWaiting = WAIT_STATUSES.includes(newStatus);
  if (!wasWaiting && isWaiting) return [{ range: `Repairs!Z${sheetRow}`, values: [[now.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })]] }];
  if (wasWaiting && !isWaiting) {
    const start = parseThaiDateTime(waitStartRaw);
    const total = (Number.parseFloat(waitMinutesRaw) || 0) + (start ? Math.max(0, (now - start) / 60000) : 0);
    return [{ range: `Repairs!AA${sheetRow}`, values: [[Math.round(total)]] }, { range: `Repairs!Z${sheetRow}`, values: [['']] }];
  }
  return [];
}

function buildJobId(dept, existingIds, now = new Date()) {
  const date = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
  const prefix = (dept || 'GEN').replace(/\s+/g, '').slice(0, 3).toUpperCase();
  const count = existingIds.filter(id => String(id || '').split('-').at(-1).slice(2) === date.slice(2)).length;
  return `${prefix}-${String(count + 1).padStart(3, '0')}-${date}`;
}

module.exports = { WAIT_STATUSES, parseThaiDateTime, buildWaitUpdateData, buildJobId };
