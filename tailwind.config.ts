import type { Config } from "tailwindcss";

const colorVar = (name: string): string => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Customer semantic tokens. New customer UI should prefer these names.
        app: {
          bg: colorVar("--color-app-bg-rgb"),
        },
        surface: {
          DEFAULT: colorVar("--color-surface-rgb"),
          raised: colorVar("--color-surface-raised-rgb"),
          soft: colorVar("--color-surface-soft-rgb"),
          glass: "var(--surface-glass)",
        },
        text: {
          strong: colorVar("--color-text-strong-rgb"),
          body: colorVar("--color-text-body-rgb"),
          muted: colorVar("--color-text-muted-rgb"),
        },
        border: {
          subtle: colorVar("--color-border-subtle-rgb"),
          strong: colorVar("--color-border-strong-rgb"),
        },
        brand: {
          DEFAULT: colorVar("--color-brand-primary-rgb"),
          dark: colorVar("--color-brand-pressed-rgb"),
          pressed: colorVar("--color-brand-pressed-rgb"),
          soft: colorVar("--color-brand-soft-rgb"),
        },
        accent: {
          purple: colorVar("--color-accent-purple-rgb"),
          "purple-soft": colorVar("--color-accent-purple-soft-rgb"),
        },
        status: {
          positive: colorVar("--color-status-positive-rgb"),
          "positive-soft": colorVar("--color-status-positive-soft-rgb"),
          warning: colorVar("--color-status-warning-rgb"),
          "warning-soft": colorVar("--color-status-warning-soft-rgb"),
          danger: colorVar("--color-status-danger-rgb"),
          "danger-soft": colorVar("--color-status-danger-soft-rgb"),
          info: colorVar("--color-status-info-rgb"),
          "info-soft": colorVar("--color-status-info-soft-rgb"),
        },
        focus: {
          ring: colorVar("--color-focus-ring-rgb"),
        },
        glass: {
          DEFAULT: "var(--surface-glass)",
        },

        // Customer compatibility aliases. Keep existing class names working.
        purple: {
          DEFAULT: colorVar("--color-accent-purple-rgb"),
          soft: colorVar("--color-accent-purple-soft-rgb"),
        },
        pos: colorVar("--color-status-positive-rgb"),
        g1: colorVar("--color-text-body-rgb"),
        g2: colorVar("--color-text-muted-rgb"),
        g3: colorVar("--color-border-strong-rgb"),
        line: colorVar("--color-border-subtle-rgb"),
        line2: colorVar("--color-border-subtle-rgb"),
        sec: colorVar("--color-surface-soft-rgb"),
        public: {
          bg: colorVar("--color-app-bg-rgb"),
          surface: colorVar("--color-surface-rgb"),
          border: colorVar("--color-border-subtle-rgb"),
          muted: colorVar("--color-text-muted-rgb"),
          trust: colorVar("--color-brand-soft-rgb"),
        },
        success: {
          bg: colorVar("--color-status-positive-soft-rgb"),
          text: colorVar("--color-status-positive-rgb"),
        },
        error: {
          bg: colorVar("--color-status-danger-soft-rgb"),
          text: colorVar("--color-status-danger-rgb"),
        },
        destructive: colorVar("--color-status-danger-rgb"),
        ink: {
          DEFAULT: colorVar("--color-text-strong-rgb"),
          body: colorVar("--color-text-body-rgb"),
          label: colorVar("--color-text-muted-rgb"),
          caption: colorVar("--color-text-muted-rgb"),
        },

        // Legacy/admin compatibility tokens. These fixed values are required
        // by docs/admin-spec.md and by existing admin/public classes.
        primary: {
          DEFAULT: "#000666",
          900: "#000999",
          800: "#0010CC",
          700: "#3333CC",
          600: "#6666DD",
          400: "#9999EE",
          200: "#CCCCF5",
          100: "#E5E5FA",
        },
        // ── Secondary (Muted Slate Blue) ─────────
        secondary: {
          DEFAULT: "#71749A",
          900: "#4A4D70",
          800: "#5A5D80",
          600: "#8185AA",
          400: "#9196BB",
          300: "#B0B4CC",
          200: "#D0D3E5",
          100: "#E8EAF2",
        },
        // ── Tertiary (Deep Burgundy) ─────────────
        tertiary: {
          DEFAULT: "#5C1800",
          900: "#7A2000",
          800: "#992800",
          700: "#BB3300",
          600: "#CC5533",
          400: "#DD8866",
          200: "#EEBBAA",
          100: "#F5DDD5",
        },
        neutral: {
          DEFAULT: "#F8F9FA",
          800: "#E0E0E0",
          600: "#C0C0C0",
          500: "#A0A0A0",
          400: "#606060",
          300: "#404040",
          200: "#202020",
          0: "#000000",
        },
        "navy-dark": "#1A1A2E",
      },

      borderRadius: {
        card: "var(--radius-card)",
        "card-lg": "var(--radius-card-lg)",
        btn: "var(--radius-button)",
        pill: "999px",
        tooltip: "var(--radius-tooltip)",
        toast: "var(--radius-toast)",
      },

      boxShadow: {
        none: "var(--shadow-none)",
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        "step-active": "var(--shadow-focus)",
        "mobile-card": "var(--shadow-card)",
        "mobile-float": "var(--shadow-float)",
        float: "var(--shadow-float)",
        modal: "var(--shadow-modal)",
        soft: "var(--shadow-card)",
        lift: "var(--shadow-float)",
        pop: "var(--shadow-modal)",
      },

      fontFamily: {
        display: ["var(--font-pretendard)", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["var(--font-pretendard)", "ui-sans-serif", "system-ui", "sans-serif"],
      },

      fontSize: {
        "headline-lg": ["44px", { lineHeight: "1.15", fontWeight: "300" }],
        "headline-sm": ["30px", { lineHeight: "1.25", fontWeight: "300" }],
        "title-lg": ["24px", { lineHeight: "1.35", fontWeight: "500" }],
        "title-sm": ["18px", { lineHeight: "1.4", fontWeight: "500" }],
        body: ["16px", { lineHeight: "1.65", fontWeight: "400" }],
        "body-sm": ["15px", { lineHeight: "1.6", fontWeight: "400" }],
        label: ["13px", { lineHeight: "1.5", fontWeight: "400" }],
        caption: ["12px", { lineHeight: "1.5", fontWeight: "400" }],
        "caption-sm": ["11px", { lineHeight: "1.5", fontWeight: "400" }],
      },

      maxWidth: {
        content: "1200px",
      },

      spacing: {
        unit: "var(--space-2)",
        "gap-component": "var(--space-4)",
        "gap-section": "var(--space-8)",
      },

      backgroundImage: {
        "hero-gradient": "var(--gradient-hero)",
        "skeleton-shimmer": "var(--gradient-skeleton-shimmer)",
      },

      backgroundSize: {
        "shimmer-200": "200% 100%",
      },

      transitionTimingFunction: {
        DEFAULT: "var(--ease-state)",
        tap: "var(--ease-tap)",
        state: "var(--ease-state)",
        sheet: "var(--ease-sheet)",
        page: "var(--ease-page)",
      },

      transitionDuration: {
        DEFAULT: "var(--duration-state)",
        tap: "var(--duration-tap)",
        state: "var(--duration-state)",
        sheet: "var(--duration-sheet)",
        page: "var(--duration-page)",
      },

      keyframes: {
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        nudge: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-7px)" },
        },
        // 도리도리: 꼬리를 축으로 좌우로 갸웃갸웃 흔들고 나머지 구간은 쉰다.
        headshake: {
          "0%, 40%, 100%": { transform: "rotate(0deg)" },
          "8%": { transform: "rotate(-7deg)" },
          "16%": { transform: "rotate(6deg)" },
          "24%": { transform: "rotate(-4deg)" },
          "32%": { transform: "rotate(2deg)" },
        },
      },

      animation: {
        shimmer: "shimmer 1.4s infinite linear",
        "fade-in": "fadeIn 0.2s ease",
        "slide-down": "slideDown 0.22s ease-out",
        nudge: "nudge 1.15s ease-in-out infinite",
        headshake: "headshake 2.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
