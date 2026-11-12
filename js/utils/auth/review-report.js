// Imported reports are untrusted files opened in an administrator's session.
export function parseReviewReport(text, allowedIconIds) {
  if (typeof text !== 'string' || text.length > 2 * 1024 * 1024) throw new Error('Завеликий звіт');
  const report = JSON.parse(text);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(report) || !object(report.cataReviews)) throw new Error('Некоректний формат звіту');
  const entries = Object.entries(report.cataReviews);
  if (entries.length > 2000) throw new Error('Забагато оцінок у звіті');
  const string = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  const reviews = Object.create(null);
  for (const [key, entry] of entries) {
    if (key.length > 160 || !object(entry)) throw new Error('Некоректна оцінка');
    const suggested = string(entry.suggestedIconId, 80);
    if (suggested && !allowedIconIds.has(suggested)) throw new Error('Невідома іконка у звіті');
    reviews[key] = {
      packId: string(entry.packId, 64), packTitle: string(entry.packTitle, 100),
      cataclysmTitle: string(entry.cataclysmTitle, 300),
      status: ['ok', 'changed', 'unreviewed'].includes(entry.status) ? entry.status : 'unreviewed',
      suggestedIconId: suggested || null, note: string(entry.note, 2000), updatedAt: string(entry.updatedAt, 64)
    };
  }
  return { reviewer: string(report.reviewer, 80), cataReviews: reviews };
}
