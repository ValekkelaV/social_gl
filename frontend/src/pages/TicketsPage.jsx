import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// Список тикетов. По умолчанию показываем только тикеты своих комитетов
// (origin ИЛИ recipient), с переключателем на "все тикеты" — RLS отдаёт
// все тикеты любому аутентифицированному, фильтр "по умолчанию свои" это
// чисто UI-логика (см. контекст/02_rls_policies.sql).

const STATUS_LABELS = {
  open: "Открыт",
  in_progress: "В работе",
  closed: "Закрыт",
};

const STATUS_TABS = ["open", "in_progress", "closed", "all"];

export default function TicketsPage() {
  const { memberships } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("mine"); // 'mine' | 'all'
  const [statusFilter, setStatusFilter] = useState("open");

  const myCommitteeIds = useMemo(
    () => new Set(memberships.map((m) => m.committee_id)),
    [memberships]
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError("");

    supabase
      .from("tickets")
      .select(
        `
        id, title, description, status, source, created_at, closed_at,
        origin_committee:committees!tickets_origin_committee_id_fkey(id, name),
        ticket_recipients(committee_id, committees(id, name)),
        ticket_comments(count)
      `
      )
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (!isMounted) return;
        if (fetchError) {
          console.error("Ошибка загрузки тикетов:", fetchError);
          setError("Не удалось загрузить тикеты");
        } else {
          setTickets(data ?? []);
        }
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = tickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (scope === "all") return true;

    const originMine = t.origin_committee && myCommitteeIds.has(t.origin_committee.id);
    const recipientMine = (t.ticket_recipients ?? []).some((r) =>
      myCommitteeIds.has(r.committee_id)
    );
    return originMine || recipientMine;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Тикеты</h1>
        <Link to="/tickets/new" className="px-3 py-1.5 border rounded text-sm font-medium">
          + Новый тикет
        </Link>
      </div>

      <div className="flex flex-wrap gap-4 items-center text-sm">
        <div className="flex gap-2">
          <button
            onClick={() => setScope("mine")}
            className={scope === "mine" ? "font-semibold underline" : "text-gray-600"}
          >
            Мои комитеты
          </button>
          <span className="text-gray-300">|</span>
          <button
            onClick={() => setScope("all")}
            className={scope === "all" ? "font-semibold underline" : "text-gray-600"}
          >
            Все тикеты
          </button>
        </div>

        <div className="flex gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={
                statusFilter === s
                  ? "px-2 py-1 border rounded font-semibold"
                  : "px-2 py-1 border rounded text-gray-600"
              }
            >
              {s === "all" ? "Все статусы" : STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Загрузка…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-gray-500">Тикетов нет.</p>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className="divide-y border rounded">
          {filtered.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="block px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">
                      {t.title}
                      {t.source === "auto" && (
                        <span className="ml-2 text-xs text-gray-500 border rounded px-1.5 py-0.5">
                          авто
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {t.origin_committee?.name ?? "—"}
                      {t.ticket_recipients?.length > 0 && (
                        <> → {t.ticket_recipients.map((r) => r.committees?.name).join(", ")}</>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">{STATUS_LABELS[t.status]}</div>
                    <div className="text-xs text-gray-400">
                      {t.ticket_comments?.[0]?.count ?? 0} коммент.
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
