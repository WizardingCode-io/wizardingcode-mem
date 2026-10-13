import { fileURLToPath } from "node:url";
import ui from "@nuxt/ui/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { MEMORY_VIEWS } from "../src/modules/memory/views.ts";

// The viewer: Vue 3, Tailwind 4 and Nuxt UI, built into one HTML file that the binary
// embeds and serves. In development, `bun run ui:dev` proxies /api and /assets to a
// running `wizardingcode-mem ui`.

const root = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  root,
  base: "./",
  plugins: [
    vue(),
    ui({
      router: false,
      ui: {
        colors: { primary: "violet", neutral: "stone" },
        // The compact scale of WizardingCode's apps (Sales OS DENSITY.md): buttons 28px
        // (sm) and 32px (md), radius 8, 12.5px semibold; fields 32px, 13px; badges 20px mono.
        button: {
          slots: { base: "rounded-lg font-semibold tracking-[-0.005em] py-0" },
          variants: {
            size: {
              xs: { base: "h-6 px-2 text-xs gap-1", leadingIcon: "size-3.5", trailingIcon: "size-3.5" },
              sm: { base: "h-7 px-3 text-[12.5px] leading-4 gap-1.5", leadingIcon: "size-3.5", trailingIcon: "size-3.5" },
              md: { base: "h-8 px-4 text-[13px] leading-4 gap-1.5", leadingIcon: "size-4", trailingIcon: "size-4" },
            },
          },
          // The DS secondary: the raised surface (white, or the dark theme's raised panel), not the page's,
          // disabled too (Nuxt UI's own disabled state would put the page's surface back).
          compoundVariants: [
            {
              color: "neutral",
              variant: "outline",
              class: "bg-(--paper-raised) hover:bg-(--surface-hover) disabled:bg-(--paper-raised) aria-disabled:bg-(--paper-raised)",
            },
          ],
          defaultVariants: { size: "sm" },
        },
        input: {
          slots: { base: "rounded-lg" },
          variants: { size: { sm: { base: "h-7 text-[12.5px]" }, md: { base: "h-8 text-[13px]" } } },
        },
        selectMenu: {
          slots: { base: "rounded-lg", content: "rounded-[10px]", item: "text-[13px] h-8" },
          variants: { size: { sm: { base: "h-7 text-[12.5px]" }, md: { base: "h-8 text-[13px]" } } },
        },
        textarea: { slots: { base: "rounded-lg text-[13px]" } },
        // Fields as the Feedback artboard draws them: label 12px semibold above, hint and
        // messages 12px below; switches labelled at 13px with a 12px line.
        formField: {
          slots: { label: "text-xs leading-4 font-semibold", hint: "text-xs leading-4", description: "text-xs leading-4", error: "mt-1 text-xs leading-4", help: "mt-1 text-xs leading-4" },
          variants: { size: { md: { root: "text-[13px]" } } },
        },
        switch: { slots: { label: "text-[13px] leading-[18px] font-medium", description: "text-xs leading-4" } },
        badge: {
          slots: { base: "font-mono tracking-[.02em] rounded" },
          variants: { size: { sm: { base: "h-5 px-1.5 text-[11px]" } } },
        },
        kbd: { base: "font-mono text-[10.5px]" },
        tooltip: {
          slots: { content: "bg-(--console) text-(--console-ink) ring-1 ring-[#332E2A] rounded-md px-2 py-1 text-xs shadow-lg" },
        },
        // Toasts are dark, as in Sales OS STATES.md: console surface, ivory text.
        toast: {
          slots: {
            root: "bg-(--console) ring-0 rounded-[10px] p-3 shadow-lg",
            title: "text-[13px] font-semibold text-(--console-ink)",
            description: "text-xs text-(--console-muted)",
            icon: "size-4",
          },
        },
        slideover: { slots: { content: "bg-(--surface)" } },
        // Banners, as STATES.md draws them: compact, 12.5px, the tone's soft fill.
        alert: { slots: { root: "rounded-lg p-2.5 gap-2", title: "text-[12.5px] leading-4 font-semibold", description: "text-xs leading-4", icon: "size-4" } },
        modal: { slots: { content: "rounded-xl ring-(--line)" } },
      },
      // The theme is written from the brand's tokens in app.css; nothing is generated here.
      dts: false,
      // Every icon the app and Nuxt UI use travels inside the page: the viewer must work
      // with no network at all, so none is fetched from iconify's API at runtime. The rail's
      // icons come from the modules (/api/modules), not from this source: each built-in
      // module's views are listed here.
      icon: { clientBundle: { scan: true, icons: MEMORY_VIEWS.map((view) => view.icon), sizeLimitKb: 512 } },
    }),
    viteSingleFile({ removeViteModuleLoader: true }),
  ],
  build: {
    outDir: fileURLToPath(new URL("../src/ui/dist", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    cssTarget: "chrome120",
    reportCompressedSize: false,
  },
  server: {
    port: 5180,
    // `changeOrigin`: the viewer's server checks the Host header, so the proxied request
    // must carry the server's own host, not localhost:5180.
    proxy: {
      "/api": { target: process.env.WIZARDINGCODE_MEM_UI ?? "http://127.0.0.1:7777", changeOrigin: true },
      "/assets": { target: process.env.WIZARDINGCODE_MEM_UI ?? "http://127.0.0.1:7777", changeOrigin: true },
    },
  },
});
