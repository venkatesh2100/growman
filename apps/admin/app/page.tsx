"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import TrafficChoroplethMap from "../components/TrafficChoroplethMap";
import MetricCard from "../components/dashboard/MetricCard";
import OrdersTableSection from "../components/dashboard/OrdersTableSection";

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
const ORDER_STATUS_OPTIONS = [
  "pending",
  "confirmed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "cancelled",
  "failed",
  "paid",
];

type Paginated<T> = {
  data: T[];
  pagination?: {
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
};

type RegionData = { code: string; name: string; value: number };

export default function Page() {
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [productsTotal, setProductsTotal] = useState(0);
  const [categoriesTotal, setCategoriesTotal] = useState(0);
  const [brandsTotal, setBrandsTotal] = useState(0);
  const [tagsTotal, setTagsTotal] = useState(0);
  const [timeFrame, setTimeFrame] = useState("daily");
  const [selectedCountry, setSelectedCountry] = useState("World");
  const [mapData, setMapData] = useState<RegionData[]>([]);
  const [isLoadingMap, setIsLoadingMap] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  const [updatingDeliveryOrderId, setUpdatingDeliveryOrderId] = useState<number | null>(null);
  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersPageSize] = useState(20);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [ordersTotalPages, setOrdersTotalPages] = useState(1);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderIdSearch, setOrderIdSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoadingMetrics(true);
        setMetricsError("");

        const [productsRes, categoriesRes, brandsRes, tagsRes] =
          await Promise.all([
            apiFetch("/products?page=1&pageSize=20"),
            apiFetch("/categories"),
            apiFetch("/brands"),
            apiFetch("/tags"),
          ]);

        if (!productsRes.ok) {
          throw new Error("Failed to load dashboard metrics.");
        }

        const productsData: Paginated<unknown> = await productsRes.json();
        const categoriesData = categoriesRes.ok ? await categoriesRes.json() : [];
        const brandsData = brandsRes.ok ? await brandsRes.json() : [];
        const tagsData = tagsRes.ok ? await tagsRes.json() : [];
        setProductsTotal(Number(productsData.pagination?.total || 0));
        setCategoriesTotal(Array.isArray(categoriesData) ? categoriesData.length : 0);
        setBrandsTotal(Array.isArray(brandsData) ? brandsData.length : 0);
        setTagsTotal(Array.isArray(tagsData) ? tagsData.length : 0);
      } catch (e: unknown) {
        setMetricsError(e instanceof Error ? e.message : "Unable to load dashboard.");
      } finally {
        setLoadingMetrics(false);
      }
    };

    load();
  }, []);

  useEffect(() => {
    const loadOrders = async () => {
      try {
        setLoadingOrders(true);
        setOrdersError("");
        const params = new URLSearchParams({
          page: String(ordersPage),
          pageSize: String(ordersPageSize),
        });
        if (orderStatusFilter !== "all") params.set("status", orderStatusFilter);
        if (orderIdSearch.trim()) params.set("orderId", orderIdSearch.trim());
        if (customerSearch.trim()) params.set("search", customerSearch.trim());

        const ordersRes = await apiFetch(`/orders?${params.toString()}`);
        if (!ordersRes.ok) {
          throw new Error("Failed to load orders.");
        }
        const ordersData: Paginated<Order> = await ordersRes.json();
        setOrders(Array.isArray(ordersData.data) ? ordersData.data : []);
        setOrdersTotal(Number(ordersData.pagination?.total || 0));
        setOrdersTotalPages(Number(ordersData.pagination?.totalPages || 1));
      } catch (e: unknown) {
        setOrdersError(e instanceof Error ? e.message : "Unable to load orders.");
      } finally {
        setLoadingOrders(false);
      }
    };

    loadOrders();
  }, [ordersPage, ordersPageSize, orderStatusFilter, orderIdSearch, customerSearch]);

  useEffect(() => {
    const fetchMap = async () => {
      try {
        setIsLoadingMap(true);
        const encodedFilter = encodeURIComponent(timeFrame);
        let resMap: Response;
        if (selectedCountry === "World") {
          resMap = await apiFetch(
            `/dashboard/map?mapType=world&country=World&timeFrame=${encodedFilter}`
          );
        } else {
          resMap = await apiFetch(
            `/dashboard/map?mapType=country&country=${encodeURIComponent(
              selectedCountry
            )}&timeFrame=${encodedFilter}`
          );
        }

        if (!resMap.ok) {
          setMapData([]);
          return;
        }

        const dataMap = await resMap.json();
        if (dataMap.success && Array.isArray(dataMap.formattedStats)) {
          setMapData(dataMap.formattedStats);
        } else {
          setMapData([]);
        }
      } catch {
        setMapData([]);
      } finally {
        setIsLoadingMap(false);
      }
    };
    fetchMap();
  }, [timeFrame, selectedCountry]);

  const metrics = useMemo(() => {
    const totalOrders = orders.length;
    const paidOrders = orders.filter(
      (order) => order.paymentStatus === "paid" || order.status === "paid"
    ).length;
    const pendingOrders = orders.filter(
      (order) => order.paymentStatus === "created" || order.status === "pending"
    ).length;
    const grossRevenue = orders.reduce((sum, order) => {
      const isPaid = order.paymentStatus === "paid" || order.status === "paid";
      return isPaid ? sum + Number(order.amount || 0) : sum;
    }, 0);
    const plantsSold = orders.reduce(
      (sum, order) =>
        sum +
        (Array.isArray(order.items)
          ? order.items.reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0)
          : 0),
      0
    );

    return { totalOrders, paidOrders, pendingOrders, grossRevenue, plantsSold };
  }, [orders]);

  const updateOrderStatus = async (orderId: number, status: string) => {
    setUpdatingOrderId(orderId);
    try {
      const response = await apiFetch(`/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error("Failed to update order status");
      }
      const updated: Order = await response.json();
      setOrders((prev) => prev.map((order) => (order.id === orderId ? updated : order)));
    } catch (e: unknown) {
      setOrdersError(e instanceof Error ? e.message : "Failed to update order status.");
    } finally {
      setUpdatingOrderId(null);
    }
  };

  const updateExpectedDeliveryDate = async (orderId: number, expectedDeliveryDate: string) => {
    setUpdatingDeliveryOrderId(orderId);
    try {
      const response = await apiFetch(`/orders/${orderId}/expected-delivery`, {
        method: "PATCH",
        body: JSON.stringify({ expectedDeliveryDate }),
      });
      if (!response.ok) {
        throw new Error("Failed to update expected delivery date");
      }
      const updated: Order = await response.json();
      setOrders((prev) => prev.map((order) => (order.id === orderId ? updated : order)));
    } catch (e: unknown) {
      setOrdersError(e instanceof Error ? e.message : "Failed to update expected delivery date.");
    } finally {
      setUpdatingDeliveryOrderId(null);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">
            Orders overview and catalog metrics at one place.
          </p>
        </section>

        {loadingMetrics && (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Loading dashboard metrics...
          </div>
        )}
        {metricsError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {metricsError}
          </div>
        )}

        {!loadingMetrics && !metricsError && (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              <MetricCard label="Total Orders" value={String(ordersTotal)} />
              <MetricCard label="Paid Orders" value={String(metrics.paidOrders)} />
              <MetricCard label="Pending Orders" value={String(metrics.pendingOrders)} />
              <MetricCard label="Total Plants Sold" value={String(metrics.plantsSold)} />
              <MetricCard
                label="Gross Order Value"
                value={`INR ${metrics.grossRevenue.toLocaleString()}`}
              />
              <MetricCard label="Total Plants (Products)" value={String(productsTotal)} />
            </section>

            <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricCard label="Categories" value={String(categoriesTotal)} />
              <MetricCard label="Brands" value={String(brandsTotal)} />
              <MetricCard label="Tags" value={String(tagsTotal)} />
            </section>

            <OrdersTableSection
              orders={orders}
              loadingOrders={loadingOrders}
              ordersError={ordersError}
              updatingOrderId={updatingOrderId}
              ordersPage={ordersPage}
              ordersTotalPages={ordersTotalPages}
              ordersTotal={ordersTotal}
              orderStatusFilter={orderStatusFilter}
              orderIdSearch={orderIdSearch}
              customerSearch={customerSearch}
              orderStatusOptions={ORDER_STATUS_OPTIONS}
              onOrderIdSearchChange={(value) => {
                setOrdersPage(1);
                setOrderIdSearch(value);
              }}
              onCustomerSearchChange={(value) => {
                setOrdersPage(1);
                setCustomerSearch(value);
              }}
              onStatusFilterChange={(value) => {
                setOrdersPage(1);
                setOrderStatusFilter(value);
              }}
              onClearFilters={() => {
                setOrderIdSearch("");
                setCustomerSearch("");
                setOrderStatusFilter("all");
                setOrdersPage(1);
              }}
              onPrevPage={() => setOrdersPage((p) => Math.max(1, p - 1))}
              onNextPage={() => setOrdersPage((p) => Math.min(ordersTotalPages, p + 1))}
              onUpdateOrderStatus={updateOrderStatus}
              onUpdateExpectedDeliveryDate={(orderId, date) => {
                if (updatingDeliveryOrderId === orderId) return;
                updateExpectedDeliveryDate(orderId, date);
              }}
            />

            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <h2 className="text-lg font-semibold text-slate-900">Traffic Map Data</h2>
                <div className="flex gap-2">
                  <select
                    value={selectedCountry}
                    onChange={(e) => setSelectedCountry(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="World">World</option>
                    <option value="India">India</option>
                  </select>
                  <select
                    value={timeFrame}
                    onChange={(e) => setTimeFrame(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
              </div>
              <div className="p-5">
                <TrafficChoroplethMap
                  country={selectedCountry === "India" ? "India" : "World"}
                  data={mapData}
                  isLoading={isLoadingMap}
                />
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
