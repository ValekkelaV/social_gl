// frontend/app/(app)/layout.tsx
//
// Route group "(app)" — обёртка для всех разделов админки (с сайдбаром).
// /login живёт вне этой группы, у него свой layout без навигации.

import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
