"use client";

import { useState, useEffect } from "react";
import {
  Store,
  RefreshCw,
  Plus,
  ArrowUpRight,
  ShoppingBag,
  Layers,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sliders,
  Package,
  Zap,
  TrendingUp,
  ShieldCheck,
  Search,
  ChevronRight,
  Clock,
  Boxes,
  Database,
  Tag,
  Key,
  X,
} from "lucide-react";

interface ChannelData {
  channel: {
    id: string;
    platform: string;
    name: string;
    sellerId: string;
    appId: string;
    isActive: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
    createdAt: string;
    _count: {
      listings: number;
      syncLogs: number;
    };
  };
  hasSecret: boolean;
  totalAllocatedStock: number;
  totalSyncedStock: number;
}

interface ListingData {
  id: string;
  sellerSku: string;
  externalListingId: string | null;
  status: string;
  channelPriceMinor: number | null;
  stockAllocation: number;
  lastSyncedStock: number;
  lastSyncAt: string | null;
  variantId: string;
  sku: string;
  productName: string;
  category: string | null;
  size: string | null;
  colour: string | null;
  basePriceMinor: number;
  totalOnHand: number;
}

interface VariantOption {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  onHand: number;
}

interface SyncLogData {
  id: string;
  type: string;
  status: string;
  itemsCount: number;
  details: string | null;
  error: string | null;
  createdAt: string;
}

interface OrderData {
  id: string;
  orderNumber: string;
  status: string;
  subtotalMinor: number;
  createdAt: string;
  customerName?: string;
  itemsCount: number;
  channelRef?: string;
}

export function CommerceClient(props: {
  initialChannels: ChannelData[];
  availableVariants: VariantOption[];
  recentMarketplaceOrders: OrderData[];
}) {
  const [channels, setChannels] = useState<ChannelData[]>(props.initialChannels);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    props.initialChannels[0]?.channel.id ?? null,
  );
  const [activeTab, setActiveTab] = useState<"overview" | "listings" | "orders" | "logs">("overview");

  // Search & Filter state for listings & orders
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Connection form state
  const [sellerId, setSellerId] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [channelName, setChannelName] = useState("");

  // Map listing form state
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [sellerSku, setSellerSku] = useState("");
  const [externalFsn, setExternalFsn] = useState("");
  const [channelPriceRupees, setChannelPriceRupees] = useState("");
  const [stockAllocation, setStockAllocation] = useState("10");

  // Listings & logs state for active channel
  const [listings, setListings] = useState<ListingData[]>([]);
  const [logs, setLogs] = useState<SyncLogData[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Active channel reference
  const currentChannel = channels.find((c) => c.channel.id === selectedChannelId) ?? channels[0];

  // Auto-load details if channel is selected
  useEffect(() => {
    if (currentChannel) {
      loadChannelDetails(currentChannel.channel.id);
    }
  }, [currentChannel?.channel?.id]);

  async function loadChannelDetails(chId: string) {
    setLoadingDetails(true);
    try {
      const [listRes, logRes] = await Promise.all([
        fetch(`/api/v1/commerce/flipkart/listings?channelId=${chId}`),
        fetch(`/api/v1/commerce/flipkart/sync?channelId=${chId}`),
      ]);
      const listData = await listRes.json();
      const logData = await logRes.json();
      if (listData.listings) setListings(listData.listings);
      if (logData.logs) setLogs(logData.logs);
    } catch {
      setMessage({ text: "Failed to load channel details", type: "error" });
    } finally {
      setLoadingDetails(false);
    }
  }

  // Handle Connecting Flipkart Account
  async function handleConnectFlipkart(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch("/api/v1/commerce/flipkart/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: channelName || `Flipkart Seller (${sellerId})`,
          sellerId,
          appId,
          appSecret,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: "Flipkart Seller Account connected and validated!", type: "success" });
        setShowConnectModal(false);
        const refreshed = await fetch("/api/v1/commerce/flipkart/channels").then((r) => r.json());
        if (refreshed.channels) {
          setChannels(refreshed.channels);
          if (!selectedChannelId && refreshed.channels[0]) {
            setSelectedChannelId(refreshed.channels[0].channel.id);
          }
        }
      } else {
        setMessage({ text: data.message || "Failed to connect Flipkart account", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error connecting account", type: "error" });
    }
  }

  // Handle Mapping Variant
  async function handleMapListing(e: React.FormEvent) {
    e.preventDefault();
    if (!currentChannel) return;
    try {
      const res = await fetch("/api/v1/commerce/flipkart/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: currentChannel.channel.id,
          variantId: selectedVariantId,
          sellerSku,
          externalListingId: externalFsn || null,
          channelPriceMinor: channelPriceRupees ? Math.round(Number(channelPriceRupees) * 100) : null,
          stockAllocation: Number(stockAllocation) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: "Variant successfully mapped to Flipkart FSN!", type: "success" });
        setShowMapModal(false);
        loadChannelDetails(currentChannel.channel.id);
      } else {
        setMessage({ text: data.message || "Failed to map listing", type: "error" });
      }
    } catch {
      setMessage({ text: "Error mapping product", type: "error" });
    }
  }

  // Trigger Inventory Sync
  async function handleInventorySync() {
    if (!currentChannel) return;
    setSyncing("inventory");
    try {
      const res = await fetch("/api/v1/commerce/flipkart/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: currentChannel.channel.id,
          action: "sync_inventory",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: data.message, type: "success" });
        loadChannelDetails(currentChannel.channel.id);
      } else {
        setMessage({ text: data.message || "Inventory sync failed", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error during sync", type: "error" });
    } finally {
      setSyncing(null);
    }
  }

  // Trigger Order Pull
  async function handlePullOrders() {
    if (!currentChannel) return;
    setSyncing("orders");
    try {
      const res = await fetch("/api/v1/commerce/flipkart/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: currentChannel.channel.id,
          action: "pull_orders",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ text: data.message, type: "success" });
        loadChannelDetails(currentChannel.channel.id);
      } else {
        setMessage({ text: data.message || "Order pull failed", type: "error" });
      }
    } catch {
      setMessage({ text: "Network error pulling orders", type: "error" });
    } finally {
      setSyncing(null);
    }
  }

  // Filter listings
  const filteredListings = listings.filter((l) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      l.productName.toLowerCase().includes(q) ||
      l.sku.toLowerCase().includes(q) ||
      l.sellerSku.toLowerCase().includes(q) ||
      (l.externalListingId && l.externalListingId.toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Toast Alert Message */}
      {message && (
        <div
          className={`flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium shadow-sm transition-all duration-300 ${
            message.type === "success"
              ? "bg-emerald-50/90 text-emerald-900 border border-emerald-200 backdrop-blur-xs"
              : "bg-rose-50/90 text-rose-900 border border-rose-200 backdrop-blur-xs"
          }`}
        >
          <div className="flex items-center gap-2.5">
            {message.type === "success" ? (
              <div className="flex size-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="size-4" />
              </div>
            ) : (
              <div className="flex size-6 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                <AlertCircle className="size-4" />
              </div>
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="rounded-md p-1 text-slate-400 hover:bg-black/5 hover:text-slate-700 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* Hero Control Bar & Marketplace Switcher */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-sky-950 p-6 text-white shadow-lg">
        {/* Decorative Grid Graphic */}
        <div className="pointer-events-none absolute -right-10 -top-10 size-60 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 right-40 size-48 rounded-full bg-blue-600/15 blur-2xl" />

        <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex size-14 items-center justify-center rounded-xl bg-white/10 backdrop-blur-md border border-white/10 shadow-inner">
              <Store className="size-7 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-400/20 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300 border border-sky-400/30">
                  <span className="size-1.5 rounded-full bg-sky-400 animate-pulse" />
                  Flipkart Direct Seller API
                </span>
                <span className="text-xs text-slate-400">Phase 6 & 8 Production</span>
              </div>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">
                {currentChannel ? currentChannel.channel.name : "Flipkart Marketplace Central"}
              </h2>
              <p className="mt-0.5 text-xs text-slate-300">
                Live automated stock allocation, price parity & bidirectional order intake.
              </p>
            </div>
          </div>

          {/* Action Buttons with Modern UI & Hover Elevations */}
          <div className="flex flex-wrap items-center gap-2.5">
            {currentChannel && (
              <>
                <button
                  type="button"
                  onClick={handleInventorySync}
                  disabled={Boolean(syncing)}
                  className="group relative flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md border border-white/15 transition-all duration-200 hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  <RefreshCw
                    className={`size-3.5 text-sky-400 transition-transform group-hover:rotate-180 ${
                      syncing === "inventory" ? "animate-spin" : ""
                    }`}
                  />
                  <span>Push Stock</span>
                </button>

                <button
                  type="button"
                  onClick={handlePullOrders}
                  disabled={Boolean(syncing)}
                  className="group relative flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md border border-white/15 transition-all duration-200 hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                >
                  <ArrowUpRight className="size-3.5 text-emerald-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  <span>Fetch Orders</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (props.availableVariants.length > 0 && props.availableVariants[0]) {
                      setSelectedVariantId(props.availableVariants[0].id);
                      setSellerSku(props.availableVariants[0].sku);
                    }
                    setShowMapModal(true);
                  }}
                  className="group relative flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur-md border border-white/15 transition-all duration-200 hover:bg-white/20 hover:scale-[1.02] active:scale-[0.98]"
                >
                  <Plus className="size-3.5 text-amber-400" />
                  <span>Map Variant</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => setShowConnectModal(true)}
              className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-sky-500/20 transition-all duration-200 hover:bg-sky-400 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Key className="size-3.5" />
              <span>{channels.length > 0 ? "Account Settings" : "Connect Flipkart"}</span>
            </button>
          </div>
        </div>

        {/* Channel Selector Bar */}
        {channels.length > 1 && (
          <div className="mt-5 flex items-center gap-2 border-t border-white/10 pt-4 text-xs">
            <span className="text-slate-400 font-medium">Switch Active Channel:</span>
            <div className="flex flex-wrap gap-1.5">
              {channels.map((ch) => (
                <button
                  key={ch.channel.id}
                  onClick={() => setSelectedChannelId(ch.channel.id)}
                  className={`rounded-lg px-2.5 py-1 font-medium transition-all ${
                    ch.channel.id === currentChannel?.channel.id
                      ? "bg-white text-slate-900 font-semibold shadow-xs"
                      : "bg-white/5 text-slate-300 hover:bg-white/10"
                  }`}
                >
                  {ch.channel.name} ({ch.channel.sellerId})
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* KPI Stats Ribbon - Pro Max Bento Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Card 1: Connection Health */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Channel Link
            </span>
            <div className={`flex size-9 items-center justify-center rounded-xl ${
              currentChannel?.channel.isActive ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
            }`}>
              <ShieldCheck className="size-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                {currentChannel ? (currentChannel.channel.isActive ? "Active" : "Paused") : "Offline"}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500 truncate">
              {currentChannel ? `Seller ID: ${currentChannel.channel.sellerId}` : "No channel connected"}
            </p>
          </div>
        </div>

        {/* Card 2: Mapped Listings */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Live Mappings
            </span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-50 text-primary">
              <Layers className="size-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                {currentChannel?.channel._count.listings ?? 0}
              </span>
              <span className="text-xs font-medium text-slate-400">Variants</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Synced with Flipkart FSN catalog
            </p>
          </div>
        </div>

        {/* Card 3: Channel Stock Buffer */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Allocated Buffer
            </span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Boxes className="size-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                {currentChannel?.totalAllocatedStock ?? 0}
              </span>
              <span className="text-xs font-medium text-slate-400">Units</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {currentChannel?.totalSyncedStock ?? 0} units pushed live
            </p>
          </div>
        </div>

        {/* Card 4: Orders Pulled */}
        <div className="group relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:border-slate-300 hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Flipkart Orders
            </span>
            <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShoppingBag className="size-5" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tracking-tight text-slate-900">
                {props.recentMarketplaceOrders.length}
              </span>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                100% Ingested
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Direct to POS canonical order ledger
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs - Pill Segmented Switcher */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold text-slate-600 shadow-inner">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all ${
              activeTab === "overview"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Zap className="size-3.5" />
            <span>Overview & Hub</span>
          </button>
          <button
            onClick={() => {
              setActiveTab("listings");
              if (currentChannel && listings.length === 0) loadChannelDetails(currentChannel.channel.id);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all ${
              activeTab === "listings"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Tag className="size-3.5" />
            <span>Listings & FSN Mappings</span>
            <span className="ml-1 rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[10px] text-slate-700">
              {listings.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("orders")}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all ${
              activeTab === "orders"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <ShoppingBag className="size-3.5" />
            <span>Marketplace Orders</span>
            <span className="ml-1 rounded-full bg-slate-200/80 px-1.5 py-0.2 text-[10px] text-slate-700">
              {props.recentMarketplaceOrders.length}
            </span>
          </button>
          <button
            onClick={() => {
              setActiveTab("logs");
              if (currentChannel && logs.length === 0) loadChannelDetails(currentChannel.channel.id);
            }}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition-all ${
              activeTab === "logs"
                ? "bg-white text-slate-900 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Clock className="size-3.5" />
            <span>Sync Audit Logs</span>
          </button>
        </div>

        {/* Global Search Bar when on Listings or Orders */}
        {(activeTab === "listings" || activeTab === "orders") && (
          <div className="relative hidden sm:block w-64">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search SKU, FSN, name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10 transition-all"
            />
          </div>
        )}
      </div>

      {/* =========================================================================
          TAB 1: OVERVIEW & HUB
          ========================================================================= */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main Channel Architecture Card */}
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Flipkart Marketplace Orchestration Hub
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Direct integration mapping POS catalog entities to Flipkart FSN identifiers.
                  </p>
                </div>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                  currentChannel?.channel.isActive
                    ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                }`}>
                  <span className={`size-2 rounded-full ${currentChannel?.channel.isActive ? "bg-emerald-500" : "bg-rose-500"}`} />
                  {currentChannel?.channel.isActive ? "Channel Ready" : "Disconnected"}
                </span>
              </div>

              {/* Channel Spec Badges */}
              <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Seller ID</span>
                  <span className="font-semibold text-slate-800 font-mono mt-0.5 block">
                    {currentChannel ? currentChannel.channel.sellerId : "Not Configured"}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">App Auth</span>
                  <span className="font-semibold text-slate-800 font-mono mt-0.5 block truncate">
                    {currentChannel ? currentChannel.channel.appId : "None"}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Security</span>
                  <span className="font-semibold text-emerald-700 mt-0.5 block flex items-center gap-1">
                    <ShieldCheck className="size-3.5" /> AES-256-GCM
                  </span>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">Last Synced</span>
                  <span className="font-semibold text-slate-800 mt-0.5 block">
                    {currentChannel?.channel.lastSyncAt
                      ? new Date(currentChannel.channel.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : "Never"}
                  </span>
                </div>
              </div>

              {/* Modern 3-Step Flow Visual */}
              <div className="mt-6 space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Data Pipeline Workflow
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/50 p-4 transition-all hover:border-slate-300 hover:shadow-xs">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 mb-3">
                      <Layers className="size-4" />
                    </div>
                    <div className="text-xs font-bold text-slate-900">1. Variant to FSN Mapping</div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                      Every Amburax variant is bound to a Flipkart FSN and unique Seller SKU.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/50 p-4 transition-all hover:border-slate-300 hover:shadow-xs">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 mb-3">
                      <Sliders className="size-4" />
                    </div>
                    <div className="text-xs font-bold text-slate-900">2. Allocation & Buffer</div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                      Physical stock minus safety buffer is automatically calculated and pushed.
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-gradient-to-b from-white to-slate-50/50 p-4 transition-all hover:border-slate-300 hover:shadow-xs">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 mb-3">
                      <ShoppingBag className="size-4" />
                    </div>
                    <div className="text-xs font-bold text-slate-900">3. Inbound Ingestion</div>
                    <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">
                      Marketplace orders stream into canonical POS order queues without duplicate sequences.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions Panel */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
              <h3 className="text-sm font-bold text-slate-900">Marketplace Actions</h3>
              <p className="text-xs text-slate-500 mt-0.5">Quick access to channel controls</p>

              <div className="mt-4 space-y-2.5">
                <button
                  onClick={() => {
                    setActiveTab("listings");
                    if (currentChannel) loadChannelDetails(currentChannel.channel.id);
                  }}
                  className="group flex w-full items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 text-left transition-all hover:border-sky-300 hover:bg-sky-50/30 hover:shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-primary group-hover:scale-105 transition-transform">
                      <Tag className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">Catalog Mappings</div>
                      <div className="text-[11px] text-slate-500">{listings.length} variants mapped</div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </button>

                <button
                  onClick={() => setActiveTab("orders")}
                  className="group flex w-full items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50/30 hover:shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 group-hover:scale-105 transition-transform">
                      <ShoppingBag className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">Inbound Orders</div>
                      <div className="text-[11px] text-slate-500">{props.recentMarketplaceOrders.length} received</div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </button>

                <button
                  onClick={() => setShowConnectModal(true)}
                  className="group flex w-full items-center justify-between rounded-xl border border-slate-200/70 bg-white p-3.5 text-left transition-all hover:border-slate-300 hover:bg-slate-50/50 hover:shadow-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700 group-hover:scale-105 transition-transform">
                      <Key className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">API Credentials</div>
                      <div className="text-[11px] text-slate-500">Flipkart OAuth & tokens</div>
                    </div>
                  </div>
                  <ChevronRight className="size-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>
            </div>

            {/* Flipkart Channel Policy Notice */}
            <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4 text-xs text-sky-950">
              <div className="flex items-center gap-2 font-bold text-sky-900">
                <Zap className="size-4 text-sky-600" />
                <span>Zero-Oversell Protection</span>
              </div>
              <p className="mt-1 text-[11px] text-sky-800 leading-relaxed">
                When physical stock hits your channel allocation buffer limit, inventory on Flipkart is automatically throttled to 0 to prevent marketplace penalties.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: LISTINGS & FSN MAPPINGS
          ========================================================================= */}
      {activeTab === "listings" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Mapped Flipkart Listings</h3>
              <p className="text-xs text-slate-500">
                Variants linked to Flipkart FSNs, dedicated stock buffers, and channel prices.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (props.availableVariants.length > 0 && props.availableVariants[0]) {
                    setSelectedVariantId(props.availableVariants[0].id);
                    setSellerSku(props.availableVariants[0].sku);
                  }
                  setShowMapModal(true);
                }}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover active:scale-[0.98] transition-all"
              >
                <Plus className="size-3.5" />
                <span>Map New Variant</span>
              </button>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                <thead className="bg-slate-50/80 font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Product & SKU</th>
                    <th className="px-5 py-3.5">Flipkart FSN / Seller SKU</th>
                    <th className="px-5 py-3.5">Base POS Price</th>
                    <th className="px-5 py-3.5">Flipkart Price</th>
                    <th className="px-5 py-3.5">Stock Buffer</th>
                    <th className="px-5 py-3.5">Synced Live</th>
                    <th className="px-5 py-3.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredListings.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-12 text-center text-sm text-slate-400">
                        {loadingDetails
                          ? "Loading catalog mappings..."
                          : searchQuery
                          ? "No listings match your search."
                          : "No products mapped to Flipkart yet. Click 'Map New Variant' to begin."}
                      </td>
                    </tr>
                  ) : (
                    filteredListings.map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-bold text-slate-900">{l.productName}</div>
                          <div className="font-mono text-[11px] text-slate-400">SKU: {l.sku}</div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="font-mono font-semibold text-sky-700">
                            {l.externalListingId || "—"}
                          </div>
                          <div className="font-mono text-[11px] text-slate-400">{l.sellerSku}</div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-600">
                          ₹{(l.basePriceMinor / 100).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 font-bold text-slate-900">
                          {l.channelPriceMinor ? (
                            <span>₹{(l.channelPriceMinor / 100).toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-400 font-normal italic">Default (₹{(l.basePriceMinor / 100).toFixed(2)})</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            {l.stockAllocation > 0 ? `${l.stockAllocation} units` : "Full Available"}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="font-mono font-bold text-emerald-700">
                            {l.lastSyncedStock}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1">in stock</span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                              l.status === "ACTIVE"
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            <span className={`size-1.5 rounded-full ${l.status === "ACTIVE" ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: MARKETPLACE ORDERS
          ========================================================================= */}
      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Inbound Flipkart Orders</h3>
              <p className="text-xs text-slate-500">
                Directly ingested into the canonical Order table with store sequence numbering.
              </p>
            </div>
            <button
              onClick={handlePullOrders}
              disabled={Boolean(syncing)}
              className="flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 text-slate-500 ${syncing === "orders" ? "animate-spin" : ""}`} />
              <span>Simulate Inbound Order</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left text-xs">
                <thead className="bg-slate-50/80 font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Order Number</th>
                    <th className="px-5 py-3.5">Customer / Logistics</th>
                    <th className="px-5 py-3.5">Quantity</th>
                    <th className="px-5 py-3.5">Total Amount</th>
                    <th className="px-5 py-3.5">Received At</th>
                    <th className="px-5 py-3.5">Canonical Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {props.recentMarketplaceOrders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-400">
                        No Flipkart marketplace orders received yet. Click &apos;Simulate Inbound Order&apos; to pull test orders.
                      </td>
                    </tr>
                  ) : (
                    props.recentMarketplaceOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="font-mono font-bold text-slate-900">{ord.orderNumber}</div>
                          <span className="inline-block mt-0.5 rounded bg-sky-50 px-1.5 py-0.2 text-[10px] font-semibold text-sky-700 border border-sky-100">
                            Flipkart Inbound
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="font-semibold text-slate-800">{ord.customerName}</div>
                          <div className="text-[11px] text-slate-400">Flipkart Logistics Hub</div>
                        </td>
                        <td className="px-5 py-3.5 font-medium text-slate-600">
                          {ord.itemsCount} line item(s)
                        </td>
                        <td className="px-5 py-3.5 font-bold text-slate-900">
                          ₹{(ord.subtotalMinor / 100).toFixed(2)}
                        </td>
                        <td className="px-5 py-3.5 text-slate-500 font-mono text-[11px]">
                          {new Date(ord.createdAt).toLocaleDateString()} {new Date(ord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            {ord.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: SYNC AUDIT LOGS
          ========================================================================= */}
      {activeTab === "logs" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">Marketplace Synchronization Logs</h3>
              <p className="text-xs text-slate-500">
                Audited history of automated and manual sync executions.
              </p>
            </div>
            {currentChannel && (
              <button
                onClick={() => loadChannelDetails(currentChannel.channel.id)}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <RefreshCw className="size-3" />
                <span>Refresh Logs</span>
              </button>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
            <div className="relative overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100 text-left font-mono text-xs">
                <thead className="bg-slate-50/80 font-bold uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Timestamp</th>
                    <th className="px-5 py-3.5">Operation Type</th>
                    <th className="px-5 py-3.5">Outcome</th>
                    <th className="px-5 py-3.5">Items</th>
                    <th className="px-5 py-3.5 font-sans">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-600">
                  {logs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400 font-sans">
                        {loadingDetails ? "Fetching sync history..." : "No synchronization jobs executed yet."}
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="px-5 py-3 text-slate-500">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                        <td className="px-5 py-3 font-semibold text-slate-900">{log.type}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            log.status === "SUCCESS"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-rose-50 text-rose-700"
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-semibold text-slate-800">{log.itemsCount}</td>
                        <td className="px-5 py-3 font-sans text-slate-700">{log.details || log.error || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 1: CONNECT FLIPKART ACCOUNT
          ========================================================================= */}
      {showConnectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setShowConnectModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200/90 p-6 animate-popIn">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                  <Store className="size-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Connect Flipkart Seller Account</h3>
              </div>
              <button
                onClick={() => setShowConnectModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              Enter your credentials from the Flipkart Seller Developer Hub. Application secrets are encrypted via AES-256-GCM.
            </p>

            <form onSubmit={handleConnectFlipkart} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Display Account Name</label>
                <input
                  type="text"
                  placeholder="e.g. Flipkart Retail India"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Flipkart Seller ID *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SL789234"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Application ID *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. app-fk-production-1"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Application Secret *</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••••••••••••••"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div className="mt-6 flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConnectModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-sky-600 px-4 py-2 font-semibold text-white shadow-md shadow-sky-600/20 hover:bg-sky-500 transition-all"
                >
                  Save & Validate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: MAP VARIANT TO FLIPKART FSN
          ========================================================================= */}
      {showMapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs transition-opacity"
            onClick={() => setShowMapModal(false)}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200/90 p-6 animate-popIn">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-blue-50 text-primary">
                  <Tag className="size-4" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Map Variant to Flipkart FSN</h3>
              </div>
              <button
                onClick={() => setShowMapModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X className="size-4" />
              </button>
            </div>

            <p className="mt-2 text-xs text-slate-500 leading-relaxed">
              Link an internal POS catalog product variant to a Flipkart FSN and configure channel allocation.
            </p>

            <form onSubmit={handleMapListing} className="mt-4 space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700">Catalog Product Variant *</label>
                <select
                  required
                  value={selectedVariantId}
                  onChange={(e) => {
                    setSelectedVariantId(e.target.value);
                    const found = props.availableVariants.find((v) => v.id === e.target.value);
                    if (found) {
                      setSellerSku(found.sku);
                      setChannelPriceRupees((found.priceMinor / 100).toString());
                    }
                  }}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                >
                  {props.availableVariants.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.sku}) — ₹{(v.priceMinor / 100).toFixed(2)} (Stock: {v.onHand})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Seller SKU *</label>
                <input
                  type="text"
                  required
                  value={sellerSku}
                  onChange={(e) => setSellerSku(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700">Flipkart FSN (Marketplace Serial Number)</label>
                <input
                  type="text"
                  placeholder="e.g. FSNTSHRT898234"
                  value={externalFsn}
                  onChange={(e) => setExternalFsn(e.target.value)}
                  className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700">Channel Price (₹)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Leave empty for base price"
                    value={channelPriceRupees}
                    onChange={(e) => setChannelPriceRupees(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700">Stock Buffer</label>
                  <input
                    type="number"
                    value={stockAllocation}
                    onChange={(e) => setStockAllocation(e.target.value)}
                    className="mt-1 block w-full rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/10"
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setShowMapModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-2 font-semibold text-white shadow-md shadow-primary/20 hover:bg-primary-hover transition-all"
                >
                  Save Mapping
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
