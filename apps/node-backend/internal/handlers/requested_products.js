// "Request this plant" notes from the shop, and the admin list of those notes.
//
// Anyone can ask for a product that is not in the catalog. The note starts
// as pending. The list is admin-only and can be filtered by status. The
// newest 200 requests are returned.

import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { isAdminRole, requireUser } from "../auth/jwt.js";
import { RequestedProduct } from "../models/index.js";

// Save a request for a product the catalog does not have yet. A signed-in shopper is recorded as the requester.
export async function createRequestedProduct(req, res) {
  const body = decode(req, res);
  if (!body) return;

  const name = String(body.productName ?? "").trim();
  if (!name) {
    error(res, 400, "productName is required");
    return;
  }

  // Where the request came from. An empty source is stored as a manual request.
  let source = String(body.source ?? "").trim().toLowerCase();
  if (!source) source = "manual";

  const requestedById = req.user?.userId ? Number(req.user.userId) : null;
  try {
    const record = await RequestedProduct.create({
      productName: name,
      details: String(body.details ?? "").trim(),
      status: "pending",
      source,
      requestedById,
      requesterName: String(body.requesterName ?? "").trim(),
      requesterEmail: String(body.requesterEmail ?? "").trim(),
      requesterPhone: String(body.requesterPhone ?? "").trim(),
      adminNotes: "",
    });
    json(res, 201, record.toJSON());
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to save requested product");
  }
}

// Admin list of product requests. A status query limits the list; otherwise every status is included.
export async function listRequestedProducts(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  // Admin check: shoppers cannot read other people's requests.
  if (!isAdminRole(claims.role)) {
    error(res, 403, "admin access required");
    return;
  }

  const raw = Array.isArray(req.query.status) ? req.query.status[0] : req.query.status;
  const status = String(raw ?? "").trim().toLowerCase();
  const where = status ? { status } : {};

  try {
    const rows = await RequestedProduct.findAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: 200,
    });
    json(res, 200, rows.map((row) => row.toJSON()));
  } catch (err) {
    console.error(err);
    error(res, 500, "failed to fetch requested products");
  }
}
