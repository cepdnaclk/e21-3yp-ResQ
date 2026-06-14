import type { ReactNode } from "react";

type DashboardLayoutProps = {
  children: ReactNode;
  sidebar?: ReactNode;
};

export function DashboardLayout({ children, sidebar }: DashboardLayoutProps) {
  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {sidebar && (
        <div className="w-full lg:w-80 shrink-0">
          <div className="space-y-6 lg:sticky lg:top-20">
            {sidebar}
          </div>
        </div>
      )}
      <div className="flex-1 min-w-0 space-y-6">
        {children}
      </div>
    </div>
  );
}

export default DashboardLayout;
