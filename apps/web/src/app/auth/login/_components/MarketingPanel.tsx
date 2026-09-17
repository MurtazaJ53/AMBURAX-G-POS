/**
 * The left-hand marketing panel of the sign-in screen.
 *
 * A server component with no state and no props — it is artwork. It is a separate file only so
 * page.tsx stays about routing and session, and this stays about pixels.
 *
 * Hidden below `lg`, which is the supplied design's deliberate mobile adaptation: on a phone the
 * sign-in form takes the whole screen rather than being pushed under a wall of marketing.
 *
 * ## A standing note for whoever edits the copy below
 *
 * Audit finding P1-3 removed an earlier version of this panel's copy because it advertised
 * capabilities the repository could not perform. The rule it left behind was: if you cannot point
 * at the route, service and test that implement a claim, it does not belong on a screen a
 * merchant reads as a statement of what they are buying.
 *
 * The content here comes from a design supplied by the product owner, and several entries — the
 * commerce, wholesale and AI feature cards, and every figure in the statistics and floating
 * cards — are forward-looking or illustrative rather than measured. That was an explicit
 * decision, not an oversight. If you are editing this file, keep the distinction in mind: the
 * P1-3 rule still applies to anything *new* you add.
 */

const features = [
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </svg>
    ),
    title: "Point of Sale",
    desc: "Fast, reliable & modern",
    bg: "#eff6ff",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#10b981"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" y1="22" x2="12" y2="12" />
      </svg>
    ),
    title: "Inventory",
    desc: "Real-time stock control",
    bg: "#ecfdf5",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: "Customers",
    desc: "Build lasting relationships",
    bg: "#eff6ff",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    title: "Reports & Analytics",
    desc: "Make smarter decisions",
    bg: "#f5f3ff",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: "Online Commerce",
    desc: "Marketplaces & web stores",
    bg: "#eff6ff",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#10b981"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    title: "B2B & Wholesale",
    desc: "Leads, quotes and orders",
    bg: "#ecfdf5",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
    title: "AI Intelligence",
    desc: "Insights and automation",
    bg: "#f5f3ff",
  },
  {
    icon: (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
    title: "Scalable Platform",
    desc: "For growing businesses",
    bg: "#eff6ff",
  },
];

const stats = [
  { val: "10K+", label: "Businesses" },
  { val: "99.9%", label: "Uptime" },
  { val: "24/7", label: "Support" },
];

const SalesGrowthCard = () => (
  <div
    className="absolute right-6 top-6 z-10 w-48 rounded-2xl bg-white p-4 shadow-xl"
    style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)" }}
  >
    <p className="text-xs font-medium text-slate-500">Sales Growth</p>
    <p className="mt-0.5 text-lg font-bold text-emerald-500">+18.4%</p>
    <div className="mt-3 flex h-10 items-end gap-1">
      {[3, 5, 4, 6, 5, 7, 8, 9, 8, 10].map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{ height: `${h * 4}px`, background: i >= 7 ? "#3b82f6" : "#bfdbfe" }}
        />
      ))}
    </div>
  </div>
);

const MultiChannelCard = () => (
  <div
    className="absolute right-12 top-52 z-10 rounded-2xl bg-white p-3 shadow-xl"
    style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)", minWidth: 180 }}
  >
    <p className="mb-2 text-xs font-semibold text-slate-700">Multi-Channel</p>
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
        a
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-yellow-400">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
        </svg>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="white" aria-hidden="true">
          <path d="M15.5 2.1l-.4 1.3c-.8-.2-1.6-.3-2.4-.3C8.9 3.1 6 6.4 6 10.3c0 2.5 1.1 4.8 2.9 6.3L7.6 22h8.8l.6-5.8c1.1-1.2 1.8-2.8 1.8-4.6 0-2.3-1.1-4.3-2.8-5.6l.5-1.5c1 .3 1.9.7 2.6 1.3l.9-2.8c-1.2-.6-2.6-1-4-1z" />
        </svg>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400">
        ···
      </div>
    </div>
  </div>
);

const HappyCustomersCard = () => (
  <div
    className="absolute bottom-44 left-2 z-10 rounded-2xl bg-white p-3 shadow-xl"
    style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.12)", minWidth: 160 }}
  >
    <p className="text-xs font-medium text-slate-500">Happy Customers</p>
    <p className="mt-1 text-2xl font-extrabold text-slate-800">52,000+</p>
    <div className="mt-2 flex items-center gap-1">
      {["#f97316", "#3b82f6", "#10b981"].map((c, i) => (
        <div
          key={c}
          className="h-6 w-6 rounded-full border-2 border-white"
          style={{ background: c, marginLeft: i > 0 ? -8 : 0, zIndex: 3 - i }}
        />
      ))}
      <div
        className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-xs font-bold text-slate-500"
        style={{ marginLeft: -8 }}
      >
        +
      </div>
    </div>
  </div>
);

const AIInsightsCard = () => (
  <div
    className="absolute bottom-16 right-4 z-10 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 shadow-lg"
    style={{ boxShadow: "0 8px 24px rgba(59,130,246,0.15)" }}
  >
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-500">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    </div>
    <p className="text-xs font-medium leading-tight text-blue-700">
      AI powered insights
      <br />
      for a better tomorrow
    </p>
  </div>
);

export function MarketingPanel() {
  return (
    <div
      className="relative hidden flex-1 flex-col justify-between overflow-hidden px-10 py-10 lg:flex"
      style={{ background: "linear-gradient(145deg, #f0f6ff 0%, #f8faff 60%, #eef4ff 100%)" }}
    >
      {/* Decorative wash behind the content. Non-interactive by construction. */}
      <div
        className="pointer-events-none absolute rounded-full"
        style={{
          width: 520,
          height: 520,
          background: "radial-gradient(circle, rgba(59,130,246,0.06) 0%, transparent 70%)",
          top: "5%",
          right: "-10%",
        }}
        aria-hidden="true"
      />

      <div className="max-w-xl">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-4 py-1.5">
          <span className="text-sm font-medium text-blue-700">All Businesses. One Platform.</span>
        </div>

        <h1 className="mb-4 text-4xl font-extrabold leading-tight text-slate-900 xl:text-5xl">
          Run Your Business
          <br />
          Smarter, <span className="text-blue-600">Every Day</span>
        </h1>

        <p className="mb-8 max-w-md text-base leading-relaxed text-slate-500">
          A modern, all-in-one POS and business operating system for retail, e-commerce and B2B.
          Manage sales, inventory, customers and growth — effortlessly.
        </p>

        <div className="mb-8 grid grid-cols-2 gap-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white p-3 shadow-sm"
            >
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
                style={{ background: f.bg }}
              >
                {f.icon}
              </div>
              <div>
                <p className="text-sm font-semibold leading-tight text-slate-800">{f.title}</p>
                <p className="mt-0.5 text-xs text-slate-400">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6 flex items-center gap-10">
          {stats.map((s) => (
            <div key={s.label}>
              <p className="text-2xl font-extrabold text-slate-800">{s.val}</p>
              <p className="text-sm text-slate-400">{s.label}</p>
            </div>
          ))}
        </div>

        <p className="text-sm italic text-slate-400">
          &ldquo;More Sales. Happier Customers. A Smarter Tomorrow.&rdquo;
        </p>
      </div>

      {/*
        The floating cards. `pointer-events-none` on the container is load-bearing rather than
        tidy: these are absolutely positioned over the panel and would otherwise sit between the
        cursor and anything beneath them. Nothing in here is interactive, so nothing is lost.
      */}
      <div
        className="pointer-events-none absolute bottom-0 right-0 top-16 w-80 select-none xl:w-96"
        aria-hidden="true"
      >
        <SalesGrowthCard />
        <MultiChannelCard />
        <HappyCustomersCard />
        <AIInsightsCard />
      </div>
    </div>
  );
}
