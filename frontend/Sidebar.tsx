// frontend/components/Sidebar.tsx
//
// Простая боковая навигация по двум разделам контекста: "Секции" (заявки,
// расписание) и "Задачи" (тикеты, контент-план, коммуникации). Клиентский
// компонент, т.к. использует usePathname для подсветки активного пункта.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
}

const sectionsNav: NavItem[] = [
  { href: "/applications", label: "Заявки" },
  { href: "/schedule", label: "Расписание" },
];

const tasksNav: NavItem[] = [
  { href: "/tickets", label: "Тикеты" },
  { href: "/content-plan", label: "Контент-план" },
  { href: "/communications", label: "Коммуникации" },
];

function NavLink({ item }: { item: NavItem }) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(item.href);

  return (
    <Link
      href={item.href}
      className={`block rounded-md px-3 py-2 text-sm transition-colors ${
        isActive
          ? "bg-stone-900 text-stone-50"
          : "text-stone-600 hover:bg-stone-200"
      }`}
    >
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col gap-6 border-r border-stone-200 bg-white p-4">
      <div>
        <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-stone-400">
          Секции
        </div>
        <div className="flex flex-col gap-1">
          {sectionsNav.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-stone-400">
          Задачи
        </div>
        <div className="flex flex-col gap-1">
          {tasksNav.map((item) => (
            <NavLink key={item.href} item={item} />
          ))}
        </div>
      </div>
    </nav>
  );
}
