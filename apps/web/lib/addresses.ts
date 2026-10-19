/**
 * Saved shipping addresses (`/addresses`).
 *
 * `isDefault` is decided by the server — the first address saved becomes the
 * default, and deleting the default promotes another — so the list is re-read
 * after every write rather than patched in place.
 */

export interface SavedAddress {
  id: number;
  userId: number;
  label?: string;
  name: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AddressListResponse {
  addresses: SavedAddress[];
}

/** Mirrors `maxSavedAddresses` in the backend address handler. */
export const MAX_SAVED_ADDRESSES = 10;

export interface AddressInput {
  label: string;
  name: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
}

export const emptyAddressInput: AddressInput = {
  label: "",
  name: "",
  phone: "",
  addressLine: "",
  city: "",
  state: "",
  pincode: "",
  isDefault: false,
};

export function toAddressInput(address: SavedAddress): AddressInput {
  return {
    label: address.label ?? "",
    name: address.name,
    phone: address.phone.replace(/\D/g, "").slice(-10),
    addressLine: address.addressLine,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    isDefault: address.isDefault,
  };
}

export interface AddressCoords {
  latitude?: number;
  longitude?: number;
}

/** The body `POST /addresses` and `PUT /addresses/{id}` accept. */
export interface AddressPayload extends AddressInput, AddressCoords {}

/**
 * A PUT rewrites the coordinate columns, so known coordinates have to be sent
 * back with every edit. Omitting them would discard the precise location the
 * shopper captured with "Use my location".
 */
export function addressPayload(
  input: AddressInput,
  coords?: AddressCoords | null
): AddressPayload {
  return {
    ...input,
    label: input.label.trim(),
    name: input.name.trim(),
    addressLine: input.addressLine.trim(),
    city: input.city.trim(),
    ...(coords?.latitude !== undefined ? { latitude: coords.latitude } : {}),
    ...(coords?.longitude !== undefined ? { longitude: coords.longitude } : {}),
  };
}

/** The same rules checkout applies, so an address saved here passes there. */
export function validateAddressInput(input: AddressInput): string | null {
  if (!input.name.trim()) return "Please enter the recipient's full name.";
  if (!/^[6-9]\d{9}$/.test(input.phone)) {
    return "Enter a valid 10-digit Indian mobile number.";
  }
  if (!input.addressLine.trim()) return "Please enter the street address.";
  if (!input.state) return "Please select a state.";
  if (!input.city.trim()) return "Please enter a city.";
  if (!/^[1-9]\d{5}$/.test(input.pincode)) {
    return "Enter a valid 6-digit pincode.";
  }
  return null;
}

/** "City, State 500001" — the second line of a displayed address. */
export function addressRegionLine(address: SavedAddress): string {
  const place = [address.city, address.state].filter(Boolean).join(", ");
  return [place, address.pincode].filter(Boolean).join(" ");
}
