// Page numbers for catalog, order, and admin lists.
// List handlers call parsePagination on the query string, then buildPaginationMeta for the response.
// parsePagination returns page, pageSize, and the SQL offset. buildPaginationMeta returns the page object the app shows.

// Reads page and pageSize from the query. Missing or junk values stay at the defaults.
// Returns { page, pageSize, offset } for a LIMIT/OFFSET query.
export function parsePagination(req) {
  let page = 1;
  let pageSize = 20;
  const p = req.query?.page;
  const ps = req.query?.pageSize;
  // Ignore a missing, zero, or non-numeric page so a bad link still shows the first page.
  if (p) {
    const parsed = Number.parseInt(p, 10);
    if (Number.isFinite(parsed) && parsed > 0) page = parsed;
  }
  if (ps) {
    let parsed = Number.parseInt(ps, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      // Cap the page so a client cannot ask for thousands of products in one response.
      if (parsed > 100) parsed = 100;
      pageSize = parsed;
    }
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

// Turns a total row count into the page object the app uses for next and previous buttons.
// Callers pass the same page and pageSize they queried with. Returns the meta object.
export function buildPaginationMeta(page, pageSize, total) {
  // Round up so a partial last page still counts. An empty list is still page 1 of 1.
  let totalPages = Math.floor((Number(total) + pageSize - 1) / pageSize);
  if (totalPages === 0) totalPages = 1;
  return {
    page,
    pageSize,
    total: Number(total),
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}
