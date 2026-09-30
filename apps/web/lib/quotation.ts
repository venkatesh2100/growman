import { apiFetch } from "./api";
import { UserFacingError } from "./errors";

export type QuotationLine = {
  no: number;
  itemCode: string;
  name: string;
  size: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  requested: boolean;
};

export type QuotationCharge = {
  label: string;
  requested: boolean;
  amount: number | null;
};

export type QuotationRequester = {
  name: string;
  company: string;
  phone: string;
  email: string;
  gstin: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  requiredBy: string;
  notes: string;
};

export type Quotation = {
  estimateNo: string;
  date: string;
  placeOfSupply: string;
  requester: QuotationRequester;
  lines: QuotationLine[];
  totalUnits: number;
  goodsTotal: number;
  charges: QuotationCharge[];
  total: number;
  amountInWords: string;
  description: string[];
  terms: string[];
  issuer: string;
  issuerAddress: string;
  issuerPhone: string;
};

export type QuotationServices = {
  delivery: boolean;
  loading: boolean;
  plantation: boolean;
};

export type QuotationRequest = QuotationRequester & {
  services: QuotationServices;
  items: Array<{ productId: number; sizeId: number; quantity: number }>;
  customItems: Array<{ name: string; size: string; quantity: number }>;
  client?: QuotationClientContext;
  website: string;
};

/** Must match services.QuotationItemCode in the Go backend. */
export function quotationItemCode(productId: number, sizeId: number): string {
  return `GM${String(productId).padStart(4, "0")}${String(sizeId).padStart(4, "0")}`;
}

function groupThousands(n: number): string {
  return Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "Rs. 8,890" — the grouping used on the printed quotation. */
export function formatRupees(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const whole = Math.trunc(rounded);
  const paise = Math.round((rounded - whole) * 100);
  return paise === 0
    ? `Rs. ${groupThousands(whole)}`
    : `Rs. ${groupThousands(whole)}.${String(paise).padStart(2, "0")}`;
}

export function formatQuantity(value: number): string {
  return groupThousands(value);
}

export type QuotationClientContext = {
  timezone: string;
  language: string;
  languages: string;
  screen: string;
  viewport: string;
  platform: string;
  page: string;
  referrer: string;
  localTime: string;
};

/** Browser details sent with an enquiry so the store has context for the follow-up call. */
export function collectClientContext(): QuotationClientContext {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    // older browsers
  }
  return {
    timezone,
    language: nav.language ?? "",
    languages: (nav.languages ?? []).join(", "),
    screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}x`,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    platform: nav.userAgentData?.platform || nav.platform || "",
    page: window.location.href,
    referrer: document.referrer,
    localTime: new Date().toString(),
  };
}

export const QUOTATION_ISSUER = {
  name: "Sri Shirdi Sai Nursery",
  address: "Hyderabad, Telangana",
  phones: ["+91 95535 70568", "+91 99089 35044"],
  email: "growman.live@gmail.com",
} as const;

export function formatRate(rate: number): string {
  return rate > 0 ? formatRupees(rate) : "On request";
}

export function formatLineAmount(line: Pick<QuotationLine, "rate" | "amount">): string {
  return line.rate > 0 ? formatRupees(line.amount) : "-";
}

export function chargeValue(charge: QuotationCharge): string {
  if (charge.amount !== null) return formatRupees(charge.amount);
  return charge.requested ? "To be quoted" : "Not required";
}

export async function submitQuotation(payload: QuotationRequest): Promise<Quotation> {
  let res: Response;
  try {
    res = await apiFetch("/quotations", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  } catch {
    throw new UserFacingError("No connection. Please check your internet and try again.");
  }
  if (res.status === 429) {
    throw new UserFacingError("Too many tries. Please wait a few minutes and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new UserFacingError("Couldn't send your request. Please try again.");
  }
  return data as Quotation;
}
