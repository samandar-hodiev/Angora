/**
 * Mobile app store links. They stay null until the iOS and Android apps are published;
 * the footer then renders "coming soon" badges instead of links. Set the env values (or
 * replace these defaults) at launch.
 */
export const appStoreLinks = {
  appStore: process.env.NEXT_PUBLIC_APP_STORE_URL || null,
  googlePlay: process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL || null,
} as const;
