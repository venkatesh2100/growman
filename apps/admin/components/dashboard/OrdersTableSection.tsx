"use client";

import Link from "next/link";

type OrderItem = { quantity: number; name?: string };
type Order = {
  id: number;
  amount: number;
  currency?: string;
  status?: string;
  paymentStatus?: string;
  customerName?: string;
  customerPhone?: string;
  createdAt?: string;
  expectedDeliveryDate?: string;
  items?: OrderItem[];
};

type Props = {
  orders: Order[];
  loadingOrders: boolean;
  ordersError: string;
  updatingOrderId: number | null;
  ordersPage: number;
  ordersTotalPages: number;
  ordersTotal: number;
  orderStatusFilter: string;
  orderIdSearch: string;
  customerSearch: string;
  orderStatusOptions: string[];
  onOrderIdSearchChange: (value: string) => void;
  onCustomerSearchChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onClearFilters: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onUpdateOrderStatus: (orderId: number, status: string) => void;
  onUpdateExpectedDeliveryDate: (orderId: number, date: string) => void;
};

function OrdersTableSkeleton() {
  return (
    <tbody>
      {Array.from({ length: 8 }).map((_, idx) => (
        <tr key={`sk-${idx}`} className="border-t border-slate-100">
          {Array.from({ length: 7 }).map((__, col) => (
            <td key={`sk-${idx}-${col}`} className="px-4 py-3">
              <div className="h-4 w-full max-w-[140px] animate-pulse rounded bg-slate-200" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export default function OrdersTableSection(props: Props) {
  const {
    orders,
    loadingOrders,
    ordersError,
    updatingOrderId,
    ordersPage,
    ordersTotalPages,
    ordersTotal,
    orderStatusFilter,
    orderIdSearch,
    customerSearch,
    orderStatusOptions,
    onOrderIdSearchChange,
    onCustomerSearchChange,
    onStatusFilterChange,
    onClearFilters,
    onPrevPage,
    onNextPage,
    onUpdateOrderStatus,
    onUpdateExpectedDeliveryDate,
  } = props;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <h2 className="text-lg font-semibold text-slate-900">Recent Orders</h2>
        <Link
          href="/product/add"
          className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Add Product
        </Link>
      </div>

      <div className="border-b border-slate-100 px-5 py-3 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          value={orderIdSearch}
          onChange={(e) => onOrderIdSearchChange(e.target.value)}
          placeholder="Search by Order ID"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          value={customerSearch}
          onChange={(e) => onCustomerSearchChange(e.target.value)}
          placeholder="Search by customer name/phone/email"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={orderStatusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="all">All statuses</option>
          <option value="paid">Paid orders</option>
          <option value="created">Created orders</option>
          {orderStatusOptions.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <button
          onClick={onClearFilters}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm bg-white hover:bg-slate-50"
        >
          Clear filters
        </button>
      </div>

      {ordersError ? (
        <div className="px-5 py-3 text-sm text-red-700 bg-red-50 border-b border-red-100">{ordersError}</div>
      ) : null}

      <div className="max-h-[460px] overflow-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-slate-50 text-left text-slate-600 sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 font-medium">Order</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Items</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expected Delivery</th>
              <th className="px-4 py-3 font-medium">Date</th>
            </tr>
          </thead>

          {loadingOrders ? (
            <OrdersTableSkeleton />
          ) : (
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={6}>
                    No orders found.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr key={order.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">#{order.id}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {order.customerName || "-"}
                      <div className="text-xs text-slate-500">{order.customerPhone || ""}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {Array.isArray(order.items)
                        ? order.items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)
                        : 0}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {(order.currency || "INR").toUpperCase()} {Number(order.amount || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 inline-block w-fit">
                          {order.paymentStatus || order.status || "unknown"}
                        </span>
                        <select
                          value={order.status || "pending"}
                          disabled={updatingOrderId === order.id}
                          onChange={(e) => onUpdateOrderStatus(order.id, e.target.value)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs bg-white"
                        >
                          {orderStatusOptions.map((s) => (
                            <option key={s} value={s}>
                              {s.replace(/_/g, " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <input
                        type="date"
                        value={order.expectedDeliveryDate ? String(order.expectedDeliveryDate).slice(0, 10) : ""}
                        onChange={(e) => onUpdateExpectedDeliveryDate(order.id, e.target.value)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs bg-white"
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {order.createdAt ? new Date(order.createdAt).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          )}
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-600">
        <span>
          Page {ordersPage} of {ordersTotalPages} · {ordersTotal} total orders
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={ordersPage <= 1 || loadingOrders}
            onClick={onPrevPage}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            disabled={ordersPage >= ordersTotalPages || loadingOrders}
            onClick={onNextPage}
            className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
