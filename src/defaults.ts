export type DefaultsType = {
  LAUNCHER_NAME: string;
  BACKEND_URL: string;
  AUTH_API_URL: string;
  DISCORD_LINK: string;
  LOGO_URL: string;
  BACKGROUND_URL: string;
  PLACEHOLDER_IMAGE: string;
  LAUNCHER_VERSION: string;
  ENABLE_API: boolean;
  UPDATER_CONFIGURED: boolean;
};

const env = import.meta.env;

export const Defaults: DefaultsType = {
  LAUNCHER_NAME: env.VITE_LAUNCHER_NAME || "Project Fishk",
  BACKEND_URL: env.VITE_BACKEND_URL || "http://127.0.0.1:8080",
  AUTH_API_URL: env.VITE_AUTH_API_URL || "http://127.0.0.1:3552",
  DISCORD_LINK: env.VITE_DISCORD_LINK || "https://example.com",
  LOGO_URL: env.VITE_LOGO_URL || "/Images/logo.png",
  BACKGROUND_URL: env.VITE_BACKGROUND_URL || "/Images/build-placeholder.webp",
  PLACEHOLDER_IMAGE: env.VITE_PLACEHOLDER_IMAGE || "/Images/build-placeholder.webp",
  LAUNCHER_VERSION: env.VITE_LAUNCHER_VERSION || "1.0.56",
  ENABLE_API: env.VITE_ENABLE_API === "true",
  UPDATER_CONFIGURED: env.VITE_UPDATER_CONFIGURED === "true"
};

export const LibraryConfig = {
  KEY: "storage:library",
};
