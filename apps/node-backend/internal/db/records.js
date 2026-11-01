// Prisma-backed models. Handlers keep calling findOne, findAll, create, and
// update. Those calls go through Prisma, including soft-delete and the few
// raw SQL fragments (search rank, stock updates) that are not plain filters.

import { readFileSync } from "node:fs";
import { getPrisma } from "./client.js";
import { Op, QueryTypes, escape, literal, fn, col, where as sqlWhere, isLiteral } from "./compat.js";
import { present } from "../models/present.js";

const COLUMN_OVERRIDE = {
  OrderItem: { productSizeId: "product_size" },
};

const INCLUDE_MODEL = {
  Product: {
    sizes: "ProductSize",
    category: "Category",
    subcategory: "Subcategory",
    brand: "Brand",
    attributes: "Attribute",
    reviews: "Review",
  },
  Category: { subcategories: "Subcategory", products: "Product" },
  Subcategory: { category: "Category", products: "Product" },
  Brand: { products: "Product" },
  Review: { user: "User", product: "Product" },
  Order: { user: "User", items: "OrderItem" },
  OrderItem: { order: "Order", product: "Product" },
  Payment: { order: "Order" },
  Wishlist: { product: "Product" },
  Refund: { order: "Order" },
  OwnedPlant: { healthLogs: "PlantHealthLog" },
  PlantHealthLog: { ownedPlant: "OwnedPlant" },
  SavedItem: { product: "Product" },
  RecentView: { product: "Product" },
};

const TABLES = {
  User: "users",
  Category: "categories",
  Subcategory: "subcategories",
  Brand: "brands",
  Product: "products",
  ProductSize: "product_sizes",
  Attribute: "attributes",
  Review: "reviews",
  Order: "orders",
  OrderItem: "order_items",
  Payment: "payments",
  Wishlist: "wishlists",
  RequestedProduct: "requested_products",
  DoothaWaitlist: "dootha_waitlists",
  OrderSupportRequest: "order_support_requests",
  WebhookEvent: "webhook_events",
  Refund: "refunds",
  Coupon: "coupons",
  CouponRedemption: "coupon_redemptions",
  Address: "addresses",
  ConsentRecord: "consent_records",
  BackInStockRequest: "back_in_stock_requests",
  OwnedPlant: "owned_plants",
  PlantHealthLog: "plant_health_logs",
  NotificationPreference: "notification_preferences",
  AppNotification: "app_notifications",
  SavedItem: "saved_items",
  StoreCredit: "store_credits",
  CreditEntry: "credit_entries",
  SavedPaymentMethod: "saved_payment_methods",
  RecentView: "recent_views",
  CartSnapshot: "cart_snapshots",
  ChatTurn: "chat_turns",
  QuoteRequest: "quote_requests",
};

function delegateName(model) {
  return model[0].toLowerCase() + model.slice(1);
}

function columnName(model, field) {
  const override = COLUMN_OVERRIDE[model]?.[field];
  if (override) return override;
  return field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function camel(name) {
  return name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function isIdField(field) {
  return field === "id" || field.endsWith("Id");
}

function asBigInt(value) {
  if (value == null || typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return value;
}

function coerceValue(field, value) {
  if (!isIdField(field) || value == null) return value;
  if (typeof value === "object" && !(value instanceof Date)) return value;
  return asBigInt(value);
}

function clientOf(tx) {
  if (!tx) return getPrisma();
  return tx.__tx || tx;
}

function ident(name) {
  return `"${String(name).replace(/"/g, "")}"`;
}

function quotedColumn(model, field, alias) {
  return `${ident(alias)}.${ident(columnName(model, field))}`;
}

function hasLiteral(node) {
  if (!node || typeof node !== "object") return false;
  if (node.__literal) return true;
  if (Array.isArray(node)) return node.some(hasLiteral);
  for (const key of Object.keys(node)) {
    if (hasLiteral(node[key])) return true;
  }
  for (const sym of Object.getOwnPropertySymbols(node)) {
    if (hasLiteral(node[sym])) return true;
  }
  return false;
}

function sqlWhereToPrisma(node) {
  const attribute = node.attribute;
  let field = null;
  let insensitive = false;
  if (attribute?.__fn === "LOWER" && attribute.args?.[0]?.__col) {
    field = camel(attribute.args[0].__col);
    insensitive = true;
  } else if (attribute?.__col) {
    field = camel(attribute.__col);
  } else {
    return null;
  }
  const comparator = node.comparator;
  const mode = insensitive ? { mode: "insensitive" } : {};
  if (comparator == null || typeof comparator !== "object" || comparator instanceof Date) {
    return { [field]: insensitive ? { equals: comparator, ...mode } : comparator };
  }
  const symbols = Object.getOwnPropertySymbols(comparator);
  if (symbols.length !== 1) return null;
  const symbol = symbols[0];
  const raw = comparator[symbol];
  if (symbol === Op.ne) return { [field]: { not: raw, ...mode } };
  if (symbol === Op.in) return { [field]: { in: raw, ...mode } };
  if (symbol === Op.notIn) return { [field]: { notIn: raw, ...mode } };
  if (symbol === Op.like) {
    return { [field]: { contains: String(raw).replace(/^%/, "").replace(/%$/, ""), mode: "insensitive" } };
  }
  if (symbol === Op.is) return { [field]: raw };
  return null;
}

function translateLeaf(field, value) {
  if (value === null || typeof value !== "object" || value instanceof Date) {
    return { where: { [field]: coerceValue(field, value) } };
  }
  if (isLiteral(value) || value.__sqlWhere) return { unsupported: true };
  if (Array.isArray(value)) {
    if (!value.length) return { impossible: true };
    return { where: { [field]: { in: value.map((item) => (isIdField(field) ? asBigInt(item) : item)) } } };
  }
  const filter = {};
  const symbols = Object.getOwnPropertySymbols(value);
  if (!symbols.length) return { where: { [field]: value } };
  for (const symbol of symbols) {
    const raw = value[symbol];
    if (symbol === Op.in) {
      if (!raw?.length) return { impossible: true };
      filter.in = raw.map((item) => (isIdField(field) ? asBigInt(item) : item));
    } else if (symbol === Op.notIn) {
      filter.notIn = (raw || []).map((item) => (isIdField(field) ? asBigInt(item) : item));
    } else if (symbol === Op.ne || symbol === Op.not) {
      filter.not = isIdField(field) && raw != null ? asBigInt(raw) : raw;
    } else if (symbol === Op.gt) filter.gt = raw;
    else if (symbol === Op.gte) filter.gte = raw;
    else if (symbol === Op.lt) filter.lt = raw;
    else if (symbol === Op.lte) filter.lte = raw;
    else if (symbol === Op.like) {
      filter.contains = String(raw).replace(/^%/, "").replace(/%$/, "");
      filter.mode = "insensitive";
    } else if (symbol === Op.is) {
      return { where: { [field]: raw } };
    } else if (symbol === Op.eq) {
      filter.equals = raw;
    } else {
      return { unsupported: true };
    }
  }
  return { where: { [field]: filter } };
}

function translate(node) {
  if (node == null) return { where: undefined };
  if (node.__literal) return { unsupported: true };
  if (node.__sqlWhere) {
    const where = sqlWhereToPrisma(node);
    if (!where) return { unsupported: true };
    return { where };
  }
  const parts = [];
  for (const key of Object.keys(node)) {
    const leaf = translateLeaf(key, node[key]);
    if (leaf.unsupported || leaf.impossible) return leaf;
    if (leaf.where) parts.push(leaf.where);
  }
  for (const symbol of Object.getOwnPropertySymbols(node)) {
    const list = node[symbol];
    if (!Array.isArray(list)) return { unsupported: true };
    const children = [];
    for (const item of list) {
      const child = translate(item);
      if (child.unsupported) return child;
      if (child.impossible) {
        if (symbol === Op.and) return { impossible: true };
        continue;
      }
      if (child.where) children.push(child.where);
    }
    if (symbol === Op.and) {
      if (children.length) parts.push(children.length === 1 ? children[0] : { AND: children });
    } else if (symbol === Op.or) {
      if (!children.length) return { impossible: true };
      parts.push(children.length === 1 ? children[0] : { OR: children });
    } else {
      return { unsupported: true };
    }
  }
  if (!parts.length) return { where: undefined };
  return { where: parts.length === 1 ? parts[0] : { AND: parts } };
}

function pushParam(params, value) {
  params.push(value);
  return `$${params.length}`;
}

function valueSql(field, value, params) {
  if (value === null) return "NULL";
  if (value instanceof Date) return pushParam(params, value);
  if (isIdField(field) && (typeof value === "number" || typeof value === "bigint" || typeof value === "string")) {
    return pushParam(params, asBigInt(value));
  }
  return pushParam(params, value);
}

function leafSql(model, field, value, params, alias) {
  const column = quotedColumn(model, field, alias);
  if (value === null || typeof value !== "object" || value instanceof Date) {
    if (value === null) return `${column} IS NULL`;
    return `${column} = ${valueSql(field, value, params)}`;
  }
  if (isLiteral(value)) return `(${value.sql})`;
  if (Array.isArray(value)) {
    if (!value.length) return "FALSE";
    const list = value.map((item) => valueSql(field, item, params)).join(", ");
    return `${column} IN (${list})`;
  }
  const parts = [];
  for (const symbol of Object.getOwnPropertySymbols(value)) {
    const raw = value[symbol];
    if (symbol === Op.in) {
      if (!raw?.length) return "FALSE";
      parts.push(`${column} IN (${raw.map((item) => valueSql(field, item, params)).join(", ")})`);
    } else if (symbol === Op.notIn) {
      if (!raw?.length) parts.push("TRUE");
      else parts.push(`${column} NOT IN (${raw.map((item) => valueSql(field, item, params)).join(", ")})`);
    } else if (symbol === Op.ne || symbol === Op.not) {
      parts.push(raw === null ? `${column} IS NOT NULL` : `${column} <> ${valueSql(field, raw, params)}`);
    } else if (symbol === Op.gt) parts.push(`${column} > ${valueSql(field, raw, params)}`);
    else if (symbol === Op.gte) parts.push(`${column} >= ${valueSql(field, raw, params)}`);
    else if (symbol === Op.lt) parts.push(`${column} < ${valueSql(field, raw, params)}`);
    else if (symbol === Op.lte) parts.push(`${column} <= ${valueSql(field, raw, params)}`);
    else if (symbol === Op.like) parts.push(`${column} ILIKE ${valueSql(field, raw, params)}`);
    else if (symbol === Op.is) parts.push(raw === null ? `${column} IS NULL` : `${column} = ${valueSql(field, raw, params)}`);
    else if (symbol === Op.eq) parts.push(`${column} = ${valueSql(field, raw, params)}`);
    else return null;
  }
  if (!parts.length) return null;
  return parts.join(" AND ");
}

function whereToSql(model, node, params, alias) {
  if (node == null) return "TRUE";
  if (node.__literal) return `(${node.sql})`;
  if (node.__sqlWhere) {
    const prismaWhere = sqlWhereToPrisma(node);
    if (!prismaWhere) return "TRUE";
    const [field, value] = Object.entries(prismaWhere)[0];
    return leafSql(model, field, value, params, alias) || "TRUE";
  }
  const parts = [];
  for (const key of Object.keys(node)) {
    const sql = leafSql(model, key, node[key], params, alias);
    if (sql == null) return null;
    parts.push(sql);
  }
  for (const symbol of Object.getOwnPropertySymbols(node)) {
    const list = node[symbol];
    if (!Array.isArray(list)) return null;
    const children = [];
    for (const item of list) {
      const sql = whereToSql(model, item, params, alias);
      if (sql == null) return null;
      children.push(`(${sql})`);
    }
    if (symbol === Op.and) parts.push(children.join(" AND ") || "TRUE");
    else if (symbol === Op.or) parts.push(children.join(" OR ") || "FALSE");
    else return null;
  }
  return parts.join(" AND ") || "TRUE";
}

function orderToPrisma(order) {
  if (!order || isLiteral(order) || !Array.isArray(order)) return undefined;
  const list = [];
  for (const part of order) {
    if (isLiteral(part) || !Array.isArray(part)) return undefined;
    const [field, direction] = part;
    list.push({ [field]: String(direction || "ASC").toLowerCase() === "desc" ? "desc" : "asc" });
  }
  if (!list.length) return undefined;
  return list.length === 1 ? list[0] : list;
}

function orderToSql(model, order, alias) {
  if (!order) return "";
  if (isLiteral(order)) return order.sql;
  if (!Array.isArray(order)) return "";
  return order.map((part) => {
    if (isLiteral(part)) return part.sql;
    const [field, direction] = part;
    const dir = String(direction || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
    return `${quotedColumn(model, field, alias)} ${dir}`;
  }).join(", ");
}

function selectOf(attributes) {
  if (!attributes) return undefined;
  const select = {};
  for (const field of attributes) select[field] = true;
  if (!select.id) select.id = true;
  return select;
}

function includeTree(entries) {
  if (!entries?.length) return undefined;
  const include = {};
  for (const entry of entries) {
    const name = entry.as || entry.association;
    if (!name) continue;
    const nested = {};
    const many = ["sizes", "attributes", "reviews", "subcategories", "products", "items", "healthLogs"].includes(name);
    if (many || entry.where) {
      const translated = entry.where ? translate(entry.where) : { where: undefined };
      const alive = many ? { deletedAt: null } : null;
      if (alive && translated.where) nested.where = { AND: [alive, translated.where] };
      else nested.where = translated.where || alive || undefined;
    }
    if (entry.attributes) {
      nested.select = selectOf(entry.attributes);
      if (entry.include) Object.assign(nested.select, includeTree(entry.include) || {});
    } else if (entry.include) {
      nested.include = includeTree(entry.include);
    }
    if (nested.where == null) delete nested.where;
    const orderBy = orderToPrisma(entry.order);
    if (orderBy) nested.orderBy = orderBy;
    include[name] = Object.keys(nested).length ? nested : true;
  }
  return include;
}

function scopeWhere(where, paranoid) {
  if (paranoid === false) return where;
  const alive = { deletedAt: null };
  if (!where) return alive;
  return { AND: [alive, where] };
}

function plainFrom(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === "function") continue;
    if (Array.isArray(value)) {
      out[key] = value.map((item) => (item && typeof item.get === "function" ? item.get({ plain: true }) : item));
    } else if (value && typeof value.get === "function") {
      out[key] = value.get({ plain: true });
    } else {
      out[key] = typeof value === "bigint" ? Number(value) : value;
    }
  }
  return out;
}

function wrap(model, row, tx) {
  if (!row) return null;
  const copy = {};
  for (const [key, value] of Object.entries(row)) {
    copy[key] = typeof value === "bigint" ? Number(value) : value;
  }
  const relations = INCLUDE_MODEL[model] || {};
  for (const [name, target] of Object.entries(relations)) {
    if (Array.isArray(copy[name])) copy[name] = copy[name].map((item) => wrap(target, item, tx));
    else if (copy[name] && typeof copy[name] === "object" && !(copy[name] instanceof Date)) {
      copy[name] = wrap(target, copy[name], tx);
    }
  }
  const hidden = {
    toJSON() {
      return present(this);
    },
    get() {
      return plainFrom(this);
    },
    setDataValue(key, value) {
      this[key] = value;
    },
    async update(values, options = {}) {
      await updateRows(model, values, {
        where: { id: this.id },
        transaction: options.transaction || tx,
        paranoid: options.paranoid,
      });
      for (const [key, value] of Object.entries(values)) {
        if (!isLiteral(value)) this[key] = value;
      }
      return this;
    },
    async save(options = {}) {
      const data = {};
      for (const [key, value] of Object.entries(this)) {
        if (key === "id" || key === "createdAt" || key === "updatedAt" || key === "deletedAt") continue;
        if (typeof value === "function") continue;
        if (value && typeof value === "object" && !(value instanceof Date) && !Array.isArray(value)) continue;
        if (Array.isArray(value) && value.some((item) => item && typeof item === "object")) continue;
        data[key] = value;
      }
      await updateRows(model, data, { where: { id: this.id }, transaction: options.transaction || tx });
      return this;
    },
    async reload(options = {}) {
      const fresh = await findOneRow(model, { where: { id: this.id }, transaction: options.transaction || tx, paranoid: false });
      if (fresh) Object.assign(this, fresh.get({ plain: true }));
      return this;
    },
    async destroy(options = {}) {
      await destroyRows(model, { where: { id: this.id }, transaction: options.transaction || tx, force: options.force });
    },
    async increment(field, options = {}) {
      const by = Number(options.by ?? 1);
      await clientOf(options.transaction || tx)[delegateName(model)].update({
        where: { id: asBigInt(this.id) },
        data: { [field]: { increment: by } },
      });
      this[field] = Number(this[field] || 0) + by;
      return this;
    },
  };
  for (const [key, value] of Object.entries(hidden)) {
    Object.defineProperty(copy, key, { value, enumerable: false });
  }
  if (model === "Order") {
    Object.defineProperty(copy, "isCancellable", {
      enumerable: false,
      value() {
        if (this.cancelledAt || this.awbNumber || this.shippedAt) return false;
        return ["pending", "paid", "confirmed", "processing"].includes(this.status);
      },
    });
    Object.defineProperty(copy, "deliverySubsidy", {
      enumerable: false,
      value() {
        if (this.courierCost == null) return 0;
        return Number(this.courierCost) - Number(this.deliveryFee || 0);
      },
    });
  }
  return copy;
}

function argsForRead(model, options, translated) {
  const args = {};
  args.where = scopeWhere(translated?.where, options.paranoid);
  const orderBy = orderToPrisma(options.order);
  if (orderBy) args.orderBy = orderBy;
  if (options.limit != null) args.take = options.limit;
  if (options.offset) args.skip = options.offset;
  const include = includeTree(options.include);
  if (options.attributes) {
    args.select = selectOf(options.attributes);
    if (include) Object.assign(args.select, include);
  } else if (include) {
    args.include = include;
  }
  return args;
}

async function runRaw(tx, sql, params) {
  const rows = await clientOf(tx).$queryRawUnsafe(sql, ...params);
  return rows.map((row) => {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === "bigint" ? Number(value) : value;
    }
    return out;
  });
}

async function idsBySql(model, options) {
  const alias = model;
  const params = [];
  const filter = whereToSql(model, options.where, params, alias);
  if (filter == null) throw new Error(`unsupported filter on ${model}`);
  const alive = options.paranoid === false ? "TRUE" : `${ident(alias)}.deleted_at IS NULL`;
  let sql = `SELECT ${ident(alias)}.id FROM ${TABLES[model]} AS ${ident(alias)} WHERE ${alive} AND (${filter})`;
  const order = orderToSql(model, options.order, alias);
  if (order) sql += ` ORDER BY ${order}`;
  if (options.limit != null) {
    params.push(Number(options.limit));
    sql += ` LIMIT $${params.length}`;
  }
  if (options.offset) {
    params.push(Number(options.offset));
    sql += ` OFFSET $${params.length}`;
  }
  const rows = await runRaw(options.transaction, sql, params);
  return rows.map((row) => row.id);
}

async function hydrate(model, ids, options) {
  if (!ids.length) return [];
  const args = argsForRead(model, { ...options, where: undefined, order: undefined, limit: undefined, offset: undefined, paranoid: false }, {
    where: { id: { in: ids.map((id) => asBigInt(id)) } },
  });
  const rows = await clientOf(options.transaction)[delegateName(model)].findMany(args);
  const rank = new Map(ids.map((id, index) => [Number(id), index]));
  rows.sort((left, right) => (rank.get(Number(left.id)) ?? 0) - (rank.get(Number(right.id)) ?? 0));
  return rows.map((row) => wrap(model, row, options.transaction));
}

async function findManyRows(model, options = {}) {
  const translated = translate(options.where);
  if (translated.impossible) return [];
  const specialOrder = hasLiteral(options.order) || (Array.isArray(options.order) && options.order.some(isLiteral));
  if (translated.unsupported || hasLiteral(options.where) || specialOrder) {
    const ids = await idsBySql(model, options);
    return hydrate(model, ids, options);
  }
  const args = argsForRead(model, options, translated);
  const rows = await clientOf(options.transaction)[delegateName(model)].findMany(args);
  return rows.map((row) => wrap(model, row, options.transaction));
}

async function findOneRow(model, options = {}) {
  if (options.lock) {
    const ids = await idsBySql(model, { ...options, limit: 1, order: undefined });
    if (!ids.length) return null;
    const alias = model;
    await runRaw(
      options.transaction,
      `SELECT id FROM ${TABLES[model]} AS ${ident(alias)} WHERE ${ident(alias)}.id = $1 FOR UPDATE`,
      [asBigInt(ids[0])],
    );
    const [row] = await hydrate(model, [ids[0]], options);
    return row || null;
  }
  const rows = await findManyRows(model, { ...options, limit: 1 });
  return rows[0] || null;
}

const SCALAR_TYPES = new Set(["String", "Boolean", "Int", "Float", "DateTime", "BigInt", "Json", "Bytes", "Decimal"]);

let scalarFields;

function scalarsOf(model) {
  if (!scalarFields) {
    scalarFields = {};
    let current = null;
    const text = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    for (const line of text.split("\n")) {
      const started = line.match(/^model (\w+) \{/);
      if (started) {
        current = started[1];
        scalarFields[current] = new Set();
        continue;
      }
      if (current && line.startsWith("}")) {
        current = null;
        continue;
      }
      if (!current) continue;
      const field = line.match(/^  (\w+)\s+(\w+)/);
      if (!field) continue;
      if (SCALAR_TYPES.has(field[2])) scalarFields[current].add(field[1]);
    }
  }
  return scalarFields[model] || new Set();
}

function cleanData(model, data) {
  const allowed = scalarsOf(model);
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined || isLiteral(value)) continue;
    if (allowed.size && !allowed.has(key)) continue;
    out[key] = isIdField(key) && value != null && typeof value !== "object" ? asBigInt(value) : value;
  }
  return out;
}

async function rawUpdate(model, data, options) {
  const alias = model;
  const params = [];
  const sets = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    const column = quotedColumn(model, key, alias);
    if (isLiteral(value)) sets.push(`${column} = ${value.sql}`);
    else sets.push(`${column} = ${valueSql(key, value, params)}`);
  }
  sets.push(`${ident(alias)}.updated_at = NOW()`);
  const filter = whereToSql(model, options.where, params, alias) || "TRUE";
  const alive = options.paranoid === false ? "TRUE" : `${ident(alias)}.deleted_at IS NULL`;
  const sql = `UPDATE ${TABLES[model]} AS ${ident(alias)} SET ${sets.join(", ")} WHERE ${alive} AND (${filter})`;
  return clientOf(options.transaction).$executeRawUnsafe(sql, ...params);
}

async function updateRows(model, data, options = {}) {
  if (Object.values(data).some(isLiteral)) {
    const count = await rawUpdate(model, data, options);
    return [Number(count)];
  }
  const translated = translate(options.where);
  if (translated.impossible) return [0];
  if (translated.unsupported || hasLiteral(options.where)) {
    const count = await rawUpdate(model, data, options);
    return [Number(count)];
  }
  const result = await clientOf(options.transaction)[delegateName(model)].updateMany({
    where: scopeWhere(translated.where, options.paranoid),
    data: cleanData(model, data),
  });
  return [result.count];
}

async function destroyRows(model, options = {}) {
  const translated = translate(options.where);
  if (translated.impossible) return 0;
  const where = scopeWhere(translated.where, options.paranoid);
  const delegate = clientOf(options.transaction)[delegateName(model)];
  if (options.force) {
    const result = await delegate.deleteMany({ where: translated.where || {} });
    return result.count;
  }
  const result = await delegate.updateMany({ where, data: { deletedAt: new Date() } });
  return result.count;
}

async function createRow(model, data, options = {}) {
  const row = await clientOf(options.transaction)[delegateName(model)].create({ data: cleanData(model, data) });
  return wrap(model, row, options.transaction);
}

async function countRows(model, options = {}) {
  const translated = translate(options.where);
  if (translated.impossible) return 0;
  if (translated.unsupported || hasLiteral(options.where)) {
    const alias = model;
    const params = [];
    const filter = whereToSql(model, options.where, params, alias) || "TRUE";
    const alive = options.paranoid === false ? "TRUE" : `${ident(alias)}.deleted_at IS NULL`;
    const rows = await runRaw(
      options.transaction,
      `SELECT count(*)::int AS count FROM ${TABLES[model]} AS ${ident(alias)} WHERE ${alive} AND (${filter})`,
      params,
    );
    return Number(rows[0]?.count || 0);
  }
  return clientOf(options.transaction)[delegateName(model)].count({
    where: scopeWhere(translated.where, options.paranoid),
  });
}

function isUniqueError(err) {
  return err?.code === "P2002" || String(err?.message || "").includes("Unique constraint");
}

function repo(model) {
  return {
    findAll(options) {
      return findManyRows(model, options);
    },
    findOne(options) {
      return findOneRow(model, options);
    },
    findByPk(id, options = {}) {
      if (id == null) return Promise.resolve(null);
      return findOneRow(model, { ...options, where: { ...(options.where || {}), id } });
    },
    create(data, options) {
      return createRow(model, data, options);
    },
    async bulkCreate(rows, options) {
      const created = [];
      for (const row of rows) created.push(await createRow(model, row, options));
      return created;
    },
    async findOrCreate(options) {
      const existing = await findOneRow(model, options);
      if (existing) return [existing, false];
      try {
        const created = await createRow(model, { ...options.where, ...options.defaults }, options);
        return [created, true];
      } catch (err) {
        if (!isUniqueError(err)) throw err;
        const again = await findOneRow(model, { ...options, paranoid: false });
        if (again) return [again, false];
        throw err;
      }
    },
    update(data, options) {
      return updateRows(model, data, options);
    },
    destroy(options) {
      return destroyRows(model, options);
    },
    count(options) {
      return countRows(model, options || {});
    },
  };
}

export const User = repo("User");
export const Category = repo("Category");
export const Subcategory = repo("Subcategory");
export const Brand = repo("Brand");
export const Product = repo("Product");
export const ProductSize = repo("ProductSize");
export const Attribute = repo("Attribute");
export const Review = repo("Review");
export const Order = repo("Order");
export const OrderItem = repo("OrderItem");
export const Payment = repo("Payment");
export const Wishlist = repo("Wishlist");
export const RequestedProduct = repo("RequestedProduct");
export const DoothaWaitlist = repo("DoothaWaitlist");
export const OrderSupportRequest = repo("OrderSupportRequest");
export const WebhookEvent = repo("WebhookEvent");
export const Refund = repo("Refund");
export const Coupon = repo("Coupon");
export const CouponRedemption = repo("CouponRedemption");
export const Address = repo("Address");
export const ConsentRecord = repo("ConsentRecord");
export const BackInStockRequest = repo("BackInStockRequest");
export const OwnedPlant = repo("OwnedPlant");
export const PlantHealthLog = repo("PlantHealthLog");
export const NotificationPreference = repo("NotificationPreference");
export const AppNotification = repo("AppNotification");
export const SavedItem = repo("SavedItem");
export const StoreCredit = repo("StoreCredit");
export const CreditEntry = repo("CreditEntry");
export const SavedPaymentMethod = repo("SavedPaymentMethod");
export const RecentView = repo("RecentView");
export const CartSnapshot = repo("CartSnapshot");
export const ChatTurn = repo("ChatTurn");
export const QuoteRequest = repo("QuoteRequest");

function normalizeRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return out;
}

// The object stored on handler.sequelize. Transactions, raw SQL, and quoting
// go through Prisma. Handlers that already call this.sequelize stay on that name.
export function createDatabase() {
  return {
    LOCK: { UPDATE: "UPDATE" },
    escape,
    literal,
    fn,
    col,
    where: sqlWhere,
    async query(sql, options = {}) {
      let text = String(sql);
      const values = [];
      if (options.replacements) {
        text = text.replace(/(?<!:):(\w+)/g, (_, key) => {
          values.push(options.replacements[key]);
          return `$${values.length}`;
        });
      }
      if (Array.isArray(options.bind)) values.push(...options.bind);
      const wantsRows = options.type === QueryTypes.SELECT
        || (options.type == null && /^\s*(select|with)\b/i.test(text))
        || /\breturning\b/i.test(text);
      if (wantsRows) {
        const rows = await clientOf(options.transaction).$queryRawUnsafe(text, ...values);
        return rows.map(normalizeRow);
      }
      const count = await clientOf(options.transaction).$executeRawUnsafe(text, ...values);
      if (options.type === QueryTypes.INSERT) return [Number(count)];
      return Number(count);
    },
    async transaction(arg1, arg2) {
      const run = async (tx) => {
        const wrapped = {
          __tx: tx,
          LOCK: { UPDATE: "UPDATE" },
          $queryRawUnsafe: (...args) => tx.$queryRawUnsafe(...args),
          $executeRawUnsafe: (...args) => tx.$executeRawUnsafe(...args),
        };
        return (typeof arg1 === "function" ? arg1 : arg2)(wrapped);
      };
      if (typeof arg1 !== "function" && arg1?.transaction) {
        const tx = clientOf(arg1.transaction);
        const savepoint = `sp_${Math.random().toString(36).slice(2, 10)}`;
        await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
        try {
          const result = await arg2(arg1.transaction);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
          return result;
        } catch (err) {
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          throw err;
        }
      }
      return getPrisma().$transaction(run, { timeout: 20_000, maxWait: 10_000 });
    },
    async ensureSchema() {
      const rows = await getPrisma().$queryRawUnsafe("SELECT to_regclass('public.users') AS name");
      if (rows[0]?.name) return;
      const { spawnSync } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const root = fileURLToPath(new URL("../../", import.meta.url));
      const result = spawnSync(
        process.execPath,
        ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
        { cwd: root, stdio: "inherit", env: process.env },
      );
      if (result.status !== 0) throw new Error("prisma db push failed");
    },
    async close() {
      const { disconnectPrisma } = await import("./client.js");
      await disconnectPrisma();
    },
  };
}
