import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

// Список пунктов нава = разделы из контекста ("Секции" + "Задачи").
// Порядок соответствует приоритету MVP-разработки, не важности раздела.
const NAV_ITEMS = [
  { to: "/tickets", label: "Тикеты" },
  { to: "/content-plan", label: "Контент-план" },
  { to: "/applications", label: "Заявки" },
  { to: "/scheduling", label: "Секции и расписание" },
  { to: "/documents", label: "Документы" },
];

export default function NavShell() {
  const { person, isOwner, signOut } = useAuth();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="font-semibold">СоцПоляна</span>
          <nav className="flex gap-4">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? "underline font-medium" : "text-gray-600"
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span>
            {person?.full_name ?? "…"}
            {isOwner ? " (владелец)" : ""}
          </span>
          <button onClick={signOut} className="text-gray-600 underline">
            Выйти
          </button>
        </div>
      </header>

      <main className="flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
