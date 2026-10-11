// The settings page's state: the file's view as the server shows it, and the one way to
// change it. Every section reads from here, so a change in one is seen by the others.
import { reactive } from "vue";
import { judgesWithTypeSafe } from "./history";
import { api, type PublicSetting, type SettingKey, type SettingsError, type SettingsPatch, type SettingsView } from "./api";

export const settingsState = reactive({
  view: null as SettingsView | null,
  loading: false,
  saving: false,
  errors: {} as Partial<Record<SettingKey, string>>,
});

export async function loadSettings(): Promise<void> {
  settingsState.loading = true;
  try {
    settingsState.view = await api.settings();
  } finally {
    settingsState.loading = false;
  }
}

/** Saves a change; returns true when it was taken, false with `errors` filled when not. */
export async function saveSettings(patch: SettingsPatch): Promise<boolean> {
  settingsState.saving = true;
  settingsState.errors = {};
  try {
    settingsState.view = await api.saveSettings(patch);
    return true;
  } catch (error) {
    if (error instanceof Error && "errors" in error) {
      settingsState.errors = (error as SettingsError).errors;
      return false;
    }
    throw error;
  } finally {
    settingsState.saving = false;
  }
}

export function setting(key: SettingKey): PublicSetting | null {
  return settingsState.view?.settings[key] ?? null;
}

/** The plain value of a non-secret setting. */
export function valueOf(key: SettingKey): string | null {
  const s = setting(key);
  return s !== null && "value" in s ? s.value : null;
}

/** Set by the environment: the file cannot change it, so the page must not pretend. */
export function fromEnvironment(key: SettingKey): boolean {
  return setting(key)?.source === "env";
}

/** Whether TypeSafe judges now, as the settings stand (see `judgesWithTypeSafe`). */
export function typesafeJudging(): boolean {
  const key = setting("TYPESAFE_API_KEY");
  return judgesWithTypeSafe(key !== null && "secret" in key && key.set, valueOf("WIZARDINGCODE_MEM_TYPESAFE"));
}

export const SOURCE_LABEL: Record<"env" | "file" | "default", string> = {
  env: "from the environment",
  file: "from the settings file",
  default: "default",
};
