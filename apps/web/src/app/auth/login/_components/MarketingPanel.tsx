/**
 * The left-hand value-proposition panel of the sign-in screen.
 *
 * A server component with no state and no props — it is artwork. It is a separate file only so
 * page.tsx stays about routing and session, and this stays about pixels.
 *
 * ## Why this is a plain column and not the design's floating collage
 *
 * The supplied design (SCREENS/phase-1-screens/A1-Login.png) scatters four small cards over the
 * panel — a sales chart, a channel row, a scope card, an AI note — and the previous build
 * reproduced them literally, with `position: absolute` and hard-coded `right`/`bottom` offsets
 * inside a `flex-1` column. A `flex-1` column is exactly the thing those offsets cannot survive:
 * the panel is whatever width is left after the sign-in column takes its own, so at 1366px the
 * cards sat some 250px further left than the design ever placed them, and landed on the feature
 * grid. Measured on the old build, text-on-text collisions ran from 1024px (10 of them) through
 * 1440px (1) and only cleared at about 1500px — the collage was correct at one viewport width
 * and broken at every laptop.
 *
 * So the cards are gone rather than repositioned, and nothing was lost with them, because every
 * claim each one made is already made by something that stayed:
 *
 *   Sales Trends   → the "Reports & Analytics" feature card
 *   Multi-Channel  → the "Commerce" feature card
 *   One Platform   → the "All Businesses. One Platform." badge above the headline
 *   AI-ready       → the "AI Ready" feature card
 *
 * What is left is one bounded flex column. Nothing in it is absolutely positioned except a
 * decorative `inset-0` wash, which is what makes the responsive guarantee cheap to keep: there is
 * no element that can be placed over another at any width, because nothing here is placed — it
 * is stacked.
 *
 * ## A standing note for whoever edits the copy below
 *
 * Audit finding P1-3 removed an earlier version of this panel's copy because it advertised
 * capabilities the repository could not perform. The rule it left behind was: if you cannot point
 * at the route, service and test that implement a claim, it does not belong on a screen a
 * merchant reads as a statement of what they are buying.
 *
 * Every headline figure the supplied design carried — a customer count, an uptime percentage, a
 * growth percentage — is replaced with a capability statement rather than with a smaller number,
 * because nothing in this repository measures any of them, and a fabricated figure is not
 * improved by being conservative.
 *
 * Two rules for anything you add here. No figure without a measurement behind it. No named third
 * party — no marketplace, no processor, no platform — unless there is a connector in the
 * repository that talks to it.
 */

/**
 * `text-primary` in this Tailwind config is the *ink* token (#0f172a), not the brand — see the
 * `textColor` override in tailwind.config.ts, which deliberately shadows `colors.primary` for
 * text utilities. Brand-coloured text therefore has to name the custom property directly, and it
 * does so through this one constant so there is nothing to keep in sync.
 */
const BRAND_INK = { color: "var(--color-primary)" } as const;

/**
 * One tile treatment, not four.
 *
 * The design tinted these tiles blue, green, purple, green, blue, green, purple, blue, and the
 * previous build carried all four tints plus three different literal blues — #3b82f6 on the
 * icons, #2563eb on the submit button, #1d4ed8 in the token file. There is no semantic in the
 * design's sequence ("Reports" and "AI Ready" are purple, "Inventory" and "B2B" are green), so
 * the variety was decoration that cost the screen its ability to say which blue is AMBURAX's.
 *
 * Every tile is now the primary token on its own subtle tint. `--color-primary` is the single
 * blue this screen uses: tiles, badge, links, submit button and every focus ring.
 */
const TILE_CLASS = "grid size-9 shrink-0 place-items-center rounded bg-primary-subtle";

/**
 * The glyphs, as path data only.
 *
 * They used to be whole `<svg>` elements carrying their own width, stroke weight and colour,
 * which is how eight icons on one screen ended up drawing at two different stroke weights. The
 * wrapper below owns geometry and colour; these own shape.
 */
const features = [
  {
    title: "Point of Sale",
    desc: "Fast, reliable & modern",
    path: (
      <>
        <circle cx="8" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
        <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
      </>
    ),
  },
  {
    title: "Inventory",
    desc: "Centralized stock control",
    path: (
      <>
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.29 7 12 12 20.71 7" />
        <line x1="12" y1="22" x2="12" y2="12" />
      </>
    ),
  },
  {
    title: "Customers",
    desc: "Build lasting relationships",
    path: (
      <>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
  },
  {
    title: "Reports & Analytics",
    desc: "Make smarter decisions",
    path: (
      <>
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </>
    ),
  },
  {
    title: "Commerce",
    desc: "Connect channels & web stores",
    path: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
  {
    title: "B2B & Wholesale",
    desc: "Customers, pricing & orders",
    path: (
      <>
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </>
    ),
  },
  {
    title: "AI Ready",
    desc: "Intelligence & automation",
    path: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </>
    ),
  },
  {
    title: "Scalable Platform",
    desc: "For growing businesses",
    path: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  },
];

/**
 * What the platform *is*, in the slot the design gave to headline figures.
 *
 * The figures that were here — a customer count, an uptime percentage — were the kind of claim
 * P1-3 exists to keep off this screen: nothing in the repository measures them, and a merchant
 * reads them as fact.
 */
const capabilities = [
  { val: "Multi-Tenant", label: "Business Platform" },
  { val: "Real-Time", label: "Operations" },
  { val: "AI-Ready", label: "Intelligence" },
];

/** The strapline, shared with the compact composition page.tsx renders below `lg`. */
export const STRAPLINE = "More Sales. Happier Customers. A Smarter Tomorrow.";

/**
 * The badge and the headline are exported so the desktop panel and the compact composition cannot
 * drift: a phone and a desktop say the same sentence because they read the same component, not
 * because someone remembered to edit both.
 */
export function BrandBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full bg-primary-subtle px-3 py-1 text-[13px] font-medium ${className}`}
      style={BRAND_INK}
    >
      All Businesses. One Platform.
    </span>
  );
}

/** Size is the caller's, because the two compositions want different ones. The words are not. */
export function Headline({ className = "" }: { className?: string }) {
  return (
    <h1 className={`font-extrabold leading-[1.15] tracking-tight text-slate-900 ${className}`}>
      Run Your Business
      <br />
      Smarter, <span style={BRAND_INK}>Every Day</span>
    </h1>
  );
}

function FeatureIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className={TILE_CLASS} style={BRAND_INK} aria-hidden="true">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </span>
  );
}

export function MarketingPanel() {
  return (
    <section
      aria-label="About AMBURAX"
      className="relative hidden min-w-0 flex-1 flex-col justify-center overflow-hidden bg-background-app px-8 py-8 lg:flex xl:px-12"
    >
      {/*
        The only absolutely positioned element left, and the reason it is allowed: it is
        `inset-0`, so it is the panel's own box rather than a guess at where that box will end up,
        and it carries no content that could land on anything.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 78% 12%, rgba(29,78,216,0.07) 0%, transparent 70%)",
        }}
      />

      {/*
        `mx-auto`, so the column sits in the middle of whatever width the panel has rather than
        pinned to its left edge. The panel's width swings by ~400px across the range where it is
        drawn, and a left-pinned 672px column leaves all of that as a growing empty margin on one
        side — at 1536px it read as a layout that had run out of content. Centred, the slack
        splits evenly and the composition stays deliberate at every width.
      */}
      <div className="relative mx-auto flex w-full max-w-2xl flex-col gap-5">
        <div>
          <BrandBadge />
        </div>

        <Headline className="text-[28px] xl:text-[36px]" />

        {/*
          "POS and business operating system" was the last line still describing the product as a
          till with extras. The header says Business Operating Platform; this says the same thing,
          and names the four models the tenant model actually serves.
        */}
        <p className="max-w-[48ch] text-[15px] leading-relaxed text-slate-500">
          A modern, all-in-one business operating platform for retail, B2B, manufacturing and
          commerce. Manage sales, inventory, customers and growth — effortlessly.
        </p>

        {/*
          Two columns at every width this panel is visible at, which is `lg` and up. There, the
          panel is never narrower than about 600px — a 1024px viewport less the 420px sign-in
          column — and two cards plus their gap fit that with room to spare. `min-w-0` and
          `truncate` are the guarantee rather than the arithmetic: if a future description is
          longer than this column, it ends in an ellipsis instead of pushing the grid wider than
          its parent.
        */}
        <ul className="grid grid-cols-2 gap-2.5">
          {features.map((f) => (
            <li
              key={f.title}
              className="flex min-w-0 items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2.5 shadow-subtle"
            >
              <FeatureIcon>{f.path}</FeatureIcon>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-tight text-slate-800">
                  {f.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{f.desc}</span>
              </span>
            </li>
          ))}
        </ul>

        {/*
          `flex-wrap` is the safety net rather than the plan: the words that replaced the design's
          figures are three to four times longer than "10K+", and the type size is what keeps the
          row on one line at every width the responsive suite checks.
        */}
        <dl className="flex flex-wrap items-baseline gap-x-10 gap-y-3">
          {capabilities.map((c) => (
            <div key={c.label}>
              <dt className="text-lg font-extrabold leading-tight text-slate-800">{c.val}</dt>
              <dd className="mt-0.5 text-xs text-slate-500">{c.label}</dd>
            </div>
          ))}
        </dl>

        {/*
          The design set this line in quotation marks, which read it as a testimonial from a
          customer who does not exist. The words are the product's own strapline, so they stay;
          the quotation marks do not, because the only thing they added was an attribution.
        */}
        <p className="text-[13px] italic text-slate-500">{STRAPLINE}</p>
      </div>
    </section>
  );
}
