// Shop tables used by every handler.
//
// Prisma Client does the reading and writing. The functions here are the same
// names the route files already import (User, Order, Product, and the rest).
// present() is what JSON responses go through.

export { present, strPtr, emailOrEmpty, phoneOrEmpty } from "./present.js";
export {
  User,
  Category,
  Subcategory,
  Brand,
  Product,
  ProductSize,
  Attribute,
  Review,
  Order,
  OrderItem,
  Payment,
  Wishlist,
  RequestedProduct,
  DoothaWaitlist,
  OrderSupportRequest,
  WebhookEvent,
  Refund,
  Coupon,
  CouponRedemption,
  Address,
  ConsentRecord,
  BackInStockRequest,
  OwnedPlant,
  PlantHealthLog,
  NotificationPreference,
  AppNotification,
  SavedItem,
  StoreCredit,
  CreditEntry,
  SavedPaymentMethod,
  RecentView,
  CartSnapshot,
  ChatTurn,
  QuoteRequest,
} from "../db/records.js";
