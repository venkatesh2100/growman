// Saved delivery addresses for a signed-in customer.
//
// A customer can keep up to ten addresses. The first one saved becomes the
// default, and saving a new default clears the previous one. Phone numbers
// are Indian mobiles and pincodes are six digits. Deleting the default
// address promotes the most recently updated address that remains.

import { json, error, decode } from "../../pkg/httpjson/httpjson.js";
import { requireUser } from "../auth/jwt.js";
import { Address } from "../models/index.js";

const maxSavedAddresses = 10;
// Indian pincode: six digits, and it cannot start with 0.
const pincodeRegex = /^[1-9][0-9]{5}$/;
// Indian mobile: ten digits starting with 6, 7, 8, or 9.
const phoneRegex = /^[6-9][0-9]{9}$/;

// Address ids in the URL must be a plain positive integer.
function parseId(value) {
  const text = String(value ?? "");
  if (!/^\d+$/.test(text)) return null;
  const parsedId = Number(text);
  return Number.isSafeInteger(parsedId) ? parsedId : null;
}

// The fields checkout needs. Returns an error sentence, or an empty string when the address is acceptable.
function validateAddress(address) {
  if (!address?.name) return "name is required";
  if (!phoneRegex.test(address.phone || "")) return "invalid phone number format";
  if (!address.addressLine) return "address is required";
  if (!address.city) return "city is required";
  if (!address.state) return "state is required";
  if (!pincodeRegex.test(address.pincode || "")) return "invalid pincode format";
  return "";
}

// Only one address per customer is the default. This clears whichever one currently is.
async function clearDefaultAddress(userId, transaction) {
  await Address.update(
    { isDefault: false },
    { where: { userId, isDefault: true }, transaction, silent: true },
  );
}

// This customer's addresses, default first, then most recently updated.
export async function listAddresses(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  try {
    const addresses = await Address.findAll({
      where: { userId: claims.userId },
      order: [["isDefault", "DESC"], ["updatedAt", "DESC"]],
    });
    json(res, 200, { addresses: addresses.map((row) => row.toJSON()) });
  } catch (err) {
    console.log(`[ADDRESS] list: ${err.message}`);
    error(res, 500, "failed to load addresses");
  }
}

// Save a new address. The first address is always the default. A later one is the default only when the form says so.
export async function createAddress(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;

  const body = decode(req, res);
  if (!body) return;
  const problem = validateAddress(body);
  if (problem) {
    error(res, 400, problem);
    return;
  }

  let count;
  try {
    count = await Address.count({ where: { userId: claims.userId } });
  } catch {
    error(res, 500, "failed to save address");
    return;
  }
  if (count >= maxSavedAddresses) {
    error(res, 409, "you've reached the saved address limit — delete one first");
    return;
  }

  const isDefault = count === 0 ? true : body.isDefault === true;
  const fields = {
    userId: claims.userId,
    label: body.label ?? "",
    name: body.name ?? "",
    phone: body.phone ?? "",
    addressLine: body.addressLine ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    pincode: body.pincode ?? "",
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    isDefault,
  };

  try {
    // Clearing the old default and inserting the new row happen together.
    const created = await this.sequelize.transaction(async (transaction) => {
      if (isDefault) await clearDefaultAddress(claims.userId, transaction);
      return Address.create(fields, { transaction });
    });
    json(res, 201, created.toJSON());
  } catch (err) {
    console.log(`[ADDRESS] create: ${err.message}`);
    error(res, 500, "failed to save address");
  }
}

// Change one of this customer's addresses. A map pin is updated only when the form sends latitude or longitude.
export async function updateAddress(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const id = parseId(req.params.id);
  if (id == null) {
    error(res, 400, "invalid address ID");
    return;
  }

  let existing;
  try {
    // The address must belong to the signed-in customer.
    existing = await Address.findOne({ where: { id, userId: claims.userId } });
  } catch {
    error(res, 404, "address not found");
    return;
  }
  if (!existing) {
    error(res, 404, "address not found");
    return;
  }

  const body = decode(req, res);
  if (!body) return;
  const problem = validateAddress(body);
  if (problem) {
    error(res, 400, problem);
    return;
  }

  const data = {
    label: body.label ?? "",
    name: body.name ?? "",
    phone: body.phone ?? "",
    addressLine: body.addressLine ?? "",
    city: body.city ?? "",
    state: body.state ?? "",
    pincode: body.pincode ?? "",
    isDefault: body.isDefault === true,
  };
  const fields = ["label", "name", "phone", "addressLine", "city", "state", "pincode", "isDefault"];
  if (body.latitude != null || body.longitude != null) {
    data.latitude = body.latitude ?? null;
    data.longitude = body.longitude ?? null;
    fields.push("latitude", "longitude");
  }

  try {
    await this.sequelize.transaction(async (transaction) => {
      // Becoming the default clears the previous default in the same transaction.
      if (data.isDefault && !existing.isDefault) {
        await clearDefaultAddress(claims.userId, transaction);
      }
      await existing.update(data, { fields, transaction });
      await existing.reload({ transaction });
    });
    json(res, 200, existing.toJSON());
  } catch (err) {
    console.log(`[ADDRESS] update: ${err.message}`);
    error(res, 500, "failed to update address");
  }
}

// Delete one of this customer's addresses. If it was the default, the most recently updated address left becomes the default.
export async function deleteAddress(req, res) {
  const claims = requireUser(req, res);
  if (!claims) return;
  const id = parseId(req.params.id);
  if (id == null) {
    error(res, 400, "invalid address ID");
    return;
  }

  let existing;
  try {
    existing = await Address.findOne({ where: { id, userId: claims.userId } });
  } catch {
    error(res, 404, "address not found");
    return;
  }
  if (!existing) {
    error(res, 404, "address not found");
    return;
  }

  try {
    await this.sequelize.transaction(async (transaction) => {
      await Address.destroy({ where: { id: existing.id }, transaction });
      if (!existing.isDefault) return;
      const next = await Address.findOne({
        where: { userId: claims.userId },
        order: [["updatedAt", "DESC"]],
        transaction,
      });
      if (!next) return;
      await Address.update(
        { isDefault: true },
        { where: { id: next.id }, transaction, silent: true },
      );
    });
    json(res, 200, { success: true });
  } catch (err) {
    console.log(`[ADDRESS] delete: ${err.message}`);
    error(res, 500, "failed to delete address");
  }
}
