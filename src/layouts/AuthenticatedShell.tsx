import type { ReactNode } from 'react';

/** Presentation only. The application and the isolated reference use the same shell geometry. */
export default function AuthenticatedShell({ header, navigation, children, overlays, idPrefix = '' }: {
  header: ReactNode; navigation: ReactNode; children: ReactNode; overlays?: ReactNode; idPrefix?: string;
}) {
  return (
    <div id={idPrefix + 'main-layout'} data-appearance-part="shell" className="flex flex-col h-screen bg-primary text-light overflow-hidden">
      <header data-appearance-part="shell-header" className="lg:hidden no-print flex items-center justify-between px-4 py-3 bg-secondary border-b border-white/5 z-50">
        {header}
      </header>
      <div className="flex-1 flex flex-col landscape:max-lg:flex-row lg:flex-row overflow-hidden">
        <nav data-appearance-part="shell-nav" className="no-print flex landscape:max-lg:flex-col lg:flex-col justify-around landscape:max-lg:justify-start lg:justify-start landscape:max-lg:p-2 lg:p-4 bg-secondary w-full landscape:max-lg:w-20 lg:w-64 max-w-full lg:max-w-[256px] space-y-0 landscape:max-lg:space-y-4 lg:space-y-2 order-last landscape:max-lg:order-first lg:order-first border-t landscape:max-lg:border-t-0 lg:border-t-0 border-r border-slate-800/50">
          {navigation}
        </nav>
        <main id={idPrefix + 'main-content'} className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {children}
        </main>
      </div>
      {overlays}
    </div>
  );
}
