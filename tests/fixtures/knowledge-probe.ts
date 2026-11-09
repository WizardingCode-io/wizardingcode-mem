// The probe of the knowledge floor (ADR 0020's measure, written fresh for ADR 0024): 18
// entries with acronym, brand and Portuguese titles, personas and strategies; 12 prompts,
// each about one entry; 28 prompts about none of them. The floor passes when every
// relevant prompt brings its entry first and at most one unrelated prompt injects.

export interface ProbeEntry {
  slug: string;
  title: string;
  kind: "knowledge" | "strategy" | "persona" | "pattern";
  area: string;
  body: string;
}

export const PROBE_ENTRIES: ProbeEntry[] = [
  {
    slug: "oauth2-login-for-partner-apps",
    title: "OAuth2 login for partner apps",
    kind: "knowledge",
    area: "code",
    body: "Partner apps sign in through OAuth2 with the authorization code flow and PKCE. Tokens expire after one hour and are refreshed by the backend, never by the browser.",
  },
  {
    slug: "we-use-postgresql-not-mongodb",
    title: "We use PostgreSQL, not MongoDB",
    kind: "knowledge",
    area: "code",
    body: "Every service keeps its rows in PostgreSQL. Document stores were tried in 2024 and dropped: reporting needs joins.",
  },
  {
    slug: "user-roles",
    title: "User roles",
    kind: "knowledge",
    area: "code",
    body: "Admins manage billing and invite people. Members see only their own projects and cannot change roles.",
  },
  {
    slug: "order-lifecycle",
    title: "Order lifecycle",
    kind: "knowledge",
    area: "operations",
    body: "An order moves from draft to paid to shipped to delivered. A refund reopens a delivered order as returned; nothing ever deletes an order.",
  },
  {
    slug: "sqs-queues-for-background-jobs",
    title: "SQS queues for background jobs",
    kind: "pattern",
    area: "code",
    body: "Background jobs go through SQS with a dead-letter queue after five receives. A job handler must be idempotent: SQS delivers at least once.",
  },
  {
    slug: "discovery-call-script-for-agency-clients",
    title: "Discovery call script for agency clients",
    kind: "strategy",
    area: "sales",
    body: "Open with the agency's current clients and margins. The qualifying questions: who signs, what budget, which deadline, what failed before.",
  },
  {
    slug: "pricing-rules-for-agencies",
    title: "Pricing rules for agencies",
    kind: "strategy",
    area: "sales",
    body: "Agencies pay a monthly retainer with a three month minimum. Discounts above fifteen percent need the founder's approval.",
  },
  {
    slug: "persona-the-agency-owner",
    title: "Persona: the agency owner",
    kind: "persona",
    area: "sales",
    body: "Runs a team of five to twenty, sells retainers, hates surprises on invoices. Decides fast when the numbers are clear.",
  },
  {
    slug: "persona-a-dona-da-clinica-dentaria",
    title: "Persona: a dona da clínica dentária",
    kind: "persona",
    area: "marketing",
    body: "Gere a clínica sozinha, marca consultas por telefone e quer menos faltas dos pacientes. Decide pelo preço mensal e pela facilidade.",
  },
  {
    slug: "faturacao-mensal-dos-clientes",
    title: "Faturação mensal dos clientes",
    kind: "knowledge",
    area: "finance",
    body: "As faturas saem no primeiro dia útil do mês. Um cliente com fatura em atraso há trinta dias perde o acesso ao painel.",
  },
  {
    slug: "github-issues-are-for-bugs-only",
    title: "GitHub issues are for bugs only",
    kind: "knowledge",
    area: "code",
    body: "Feature requests go to the roadmap board, not to GitHub. An issue needs steps to reproduce and the version it happened on.",
  },
  {
    slug: "release-checklist",
    title: "Release checklist",
    kind: "pattern",
    area: "code",
    body: "Bump the version, run the full test suite, tag the commit, then publish the changelog. Never release on a Friday afternoon.",
  },
  {
    slug: "formatmoney-for-every-price",
    title: "formatMoney for every price",
    kind: "pattern",
    area: "code",
    body: "Prices are integers in cents. Show them with formatMoney(amount, currency); never divide by a hundred by hand.",
  },
  {
    slug: "brand-voice-on-social-media",
    title: "Brand voice on social media",
    kind: "strategy",
    area: "marketing",
    body: "Short sentences, no exclamation marks, no emoji. We explain what the product does; we never mock competitors.",
  },
  {
    slug: "video-thumbnails",
    title: "Video thumbnails",
    kind: "pattern",
    area: "video",
    body: "Thumbnails show one face and at most four words. Test two variants on every launch video for a week.",
  },
  {
    slug: "feature-flags",
    title: "Feature flags",
    kind: "knowledge",
    area: "code",
    body: "Remove a flag once every client runs the release that made it permanent. Flags older than ninety days are reviewed monthly.",
  },
  {
    slug: "hiring-the-first-autonomous-hire",
    title: "Hiring: the first autonomous hire",
    kind: "strategy",
    area: "people",
    body: "The first hire owns delivery end to end. The trial is a paid two-week project with a real client brief.",
  },
  {
    slug: "cash-runway-target",
    title: "Cash runway target",
    kind: "knowledge",
    area: "finance",
    body: "Keep six months of costs in the bank. Below four months, new spending stops until the pipeline covers it.",
  },
];

/** Prompts about one entry each: the entry must come first. */
export const RELEVANT: { prompt: string; slug: string }[] = [
  {
    prompt: "how do partner apps refresh their OAuth2 tokens",
    slug: "oauth2-login-for-partner-apps",
  },
  {
    prompt: "the order is delivered but the customer wants a refund, what happens to the order",
    slug: "order-lifecycle",
  },
  {
    prompt:
      "prepare the discovery call with the agency client, which qualifying questions do we ask",
    slug: "discovery-call-script-for-agency-clients",
  },
  {
    prompt: "should a background job handler retry when SQS delivers twice",
    slug: "sqs-queues-for-background-jobs",
  },
  {
    prompt: "what discount can I give an agency on the monthly retainer",
    slug: "pricing-rules-for-agencies",
  },
  {
    prompt: "a dona da clínica quer menos faltas, como falamos com ela",
    slug: "persona-a-dona-da-clinica-dentaria",
  },
  {
    prompt: "quando saem as faturas do mês e o que acontece com atraso",
    slug: "faturacao-mensal-dos-clientes",
  },
  {
    prompt: "should feature requests go to GitHub or to the roadmap board",
    slug: "github-issues-are-for-bugs-only",
  },
  {
    prompt: "what goes on the release checklist before we tag the commit",
    slug: "release-checklist",
  },
  { prompt: "how should formatMoney show prices in cents", slug: "formatmoney-for-every-price" },
  {
    prompt: "rewrite this post in our brand voice for social media",
    slug: "brand-voice-on-social-media",
  },
  {
    prompt: "how much runway in months should the bank account keep",
    slug: "cash-runway-target",
  },
];

/**
 * The one unrelated prompt the floor lets through (ADR 0020): it shares `user` with the
 * title of "User roles" and `see`, `projects` and `cannot` with its body, the same shape
 * as a question about that entry. Telling them apart needs a judge the hook does not run.
 */
export const LEAK = "the user cannot see their projects list after login";

/** Prompts about none of the entries, the leak among them. */
export const UNRELATED: string[] = [
  "the navbar overlaps the logo on mobile",
  "we don't use MongoDB here, right?",
  "open a GitHub issue for the flaky login test",
  "refactor the date picker so it accepts a time zone",
  "why is the build slow on CI since yesterday",
  "add a dark mode toggle to the settings page",
  "the tests time out when the database container starts late",
  "rename the helper that parses CSV uploads",
  "explain this regex for email validation",
  "the API returns 500 when the payload is empty",
  "write a migration that adds an index on created_at",
  "update the README with the new install steps",
  "make the chart legend wrap on small screens",
  "a função de exportar está a falhar com ficheiros grandes",
  "o botão de guardar não responde no telemóvel",
  "which version of node do we support",
  "the user avatar is blurry after upload",
  "can we cache the product images on the CDN",
  "the websocket reconnects in a loop after sleep",
  "sort the table by last modified date",
  "should this new service use MongoDB?",
  "translate the onboarding emails to Spanish",
  "the price shows NaN in the cart",
  "remove the unused imports in the payments module",
  "the release pipeline fails on the signing step",
  "what time is the team meeting on Monday",
  "the video player stutters on Safari",
  LEAK,
];
