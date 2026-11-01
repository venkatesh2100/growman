// The small set of Sequelize operators the handlers already build queries with.
// Values are symbols so a where-object can use them as keys.

export const Op = {
  and: Symbol("and"),
  or: Symbol("or"),
  in: Symbol("in"),
  notIn: Symbol("notIn"),
  ne: Symbol("ne"),
  gt: Symbol("gt"),
  gte: Symbol("gte"),
  lt: Symbol("lt"),
  lte: Symbol("lte"),
  like: Symbol("like"),
  not: Symbol("not"),
  is: Symbol("is"),
  eq: Symbol("eq"),
};

export const QueryTypes = {
  SELECT: "SELECT",
  INSERT: "INSERT",
  UPDATE: "UPDATE",
  RAW: "RAW",
};

// A fragment of SQL the query builder must not parameterize again.
// Callers pass values through escape() before placing them in the fragment.
export function literal(sql) {
  return { __literal: true, sql: String(sql) };
}

export function col(name) {
  return { __col: String(name) };
}

export function fn(name, ...args) {
  return { __fn: String(name), args };
}

// sequelize.where(fn("LOWER", col("status")), { [Op.ne]: "abandoned" })
export function where(attribute, comparator) {
  return { __sqlWhere: true, attribute, comparator };
}

export function isLiteral(value) {
  return Boolean(value && typeof value === "object" && value.__literal);
}

// Quote a JS value the way a Postgres string literal is quoted.
// Used when a handler splices a pattern into a SQL fragment.
export function escape(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}
