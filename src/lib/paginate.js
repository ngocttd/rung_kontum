// Server-side pagination for in-memory lists. Page parameter is 1-based and clamped.
function paginate(list, page, per = 10) {
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(pages, Math.max(1, Number.parseInt(page, 10) || 1));
  const start = (p - 1) * per;
  return { items: list.slice(start, start + per), page: p, pages, total, per, from: total ? start + 1 : 0, to: Math.min(total, start + per), offset: start };
}
module.exports = { paginate };
