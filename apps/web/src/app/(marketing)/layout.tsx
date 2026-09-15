import type { ReactNode } from "react";

import { I18nProvider } from "@/features/marketing/i18n";
import { SiteFooter } from "@/features/marketing/components/site-footer";
import { SiteHeader } from "@/features/marketing/components/site-header";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <I18nProvider>
      <div className="flex min-h-dvh flex-col overflow-x-clip">
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
      </div>
    </I18nProvider>
  );
}
