import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// Право менять статус = source='manual' И человек состоит в origin- либо
// recipient-комитете тикета (либо владелец) — см. tickets_update_recipient_
// or_origin_member в 02_rls_policies.sql. Авто-тикеты закрываются только
// сменой связанного поля объекта, кнопок для них здесь нет намеренно.

const STATUS_LABELS = {
  open: "Открыт",
  in_progress: "В работе",
  closed: "Закрыт",
};

export default function TicketDetailPage() {
  const { id } = useParams();
  const { person, memberships, isOwner } = useAuth();

  const [ticket, setTicket] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const myCommitteeIds = new Set(memberships.map((m) => m.committee_id));

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [{ data: ticketData, error: ticketError }, { data: commentData, error: commentError }] =
      await Promise.all([
        supabase
          .from("tickets")
          .select(
            `
            id, title, description, status, source, created_at, closed_at,
            origin_committee:committees!tickets_origin_committee_id_fkey(id, name),
            ticket_recipients(committee_id, committees(id, name))
          `
          )
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("ticket_comments")
          .select("id, body, created_at, author:people(id, full_name)")
          .eq("ticket_id", id)
          .order("created_at", { ascending: true }),
      ]);

    if (ticketError || !ticketData) {
      console.error("Ошибка загрузки тикета:", ticketError);
      setError("Тикет не найден или недоступен");
      setLoading(false);
      return;
    }
    if (commentError) {
      console.error("Ошибка загрузки комментариев:", commentError);
    }

    setTicket(ticketData);
    setComments(commentData ?? []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;

  if (error || !ticket) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/tickets" className="text-sm underline">
          ← К списку тикетов
        </Link>
      </div>
    );
  }

  const recipientIds = (ticket.ticket_recipients ?? []).map((r) => r.committee_id);
  const isRelevantMember =
    (ticket.origin_committee && myCommitteeIds.has(ticket.origin_committee.id)) ||
    recipientIds.some((cid) => myCommitteeIds.has(cid));
  const canChangeStatus = ticket.source === "manual" && (isOwner || isRelevantMember);

  async function updateStatus(nextStatus) {
    setActionError("");
    setSubmitting(true);

    const patch =
      nextStatus === "closed"
        ? { status: "closed", closed_by: person.id, closed_at: new Date().toISOString() }
        : { status: nextStatus, closed_by: null, closed_at: null };

    const { error: updateError } = await supabase.from("tickets").update(patch).eq("id", id);

    if (updateError) {
      console.error("Ошибка изменения статуса тикета:", updateError);
      setActionError("Не удалось изменить статус");
    } else {
      await load();
    }
    setSubmitting(false);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!newComment.trim()) return;

    setActionError("");
    setSubmitting(true);

    const { error: insertError } = await supabase.from("ticket_comments").insert({
      ticket_id: id,
      author_id: person.id,
      body: newComment.trim(),
    });

    if (insertError) {
      console.error("Ошибка добавления комментария:", insertError);
      setActionError("Не удалось отправить комментарий");
    } else {
      setNewComment("");
      await load();
    }
    setSubmitting(false);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Link to="/tickets" className="text-sm underline">
        ← К списку тикетов
      </Link>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">{ticket.title}</h1>
          <span className="text-sm text-gray-500">{STATUS_LABELS[ticket.status]}</span>
        </div>

        <div className="text-sm text-gray-500">
          {ticket.origin_committee?.name ?? "—"}
          {ticket.ticket_recipients?.length > 0 && (
            <> → {ticket.ticket_recipients.map((r) => r.committees?.name).join(", ")}</>
          )}
        </div>

        {ticket.source === "auto" && (
          <p className="text-xs text-gray-500 border rounded px-2 py-1 inline-block">
            Автоматический тикет — закрывается только сменой связанного поля объекта, не вручную.
          </p>
        )}

        {ticket.description && (
          <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
        )}
      </div>

      {canChangeStatus && (
        <div className="flex gap-2 text-sm">
          {ticket.status === "open" && (
            <button
              disabled={submitting}
              onClick={() => updateStatus("in_progress")}
              className="px-3 py-1.5 border rounded"
            >
              Взять в работу
            </button>
          )}
          {ticket.status !== "closed" && (
            <button
              disabled={submitting}
              onClick={() => updateStatus("closed")}
              className="px-3 py-1.5 border rounded"
            >
              Закрыть
            </button>
          )}
          {ticket.status === "closed" && (
            <button
              disabled={submitting}
              onClick={() => updateStatus("open")}
              className="px-3 py-1.5 border rounded"
            >
              Переоткрыть
            </button>
          )}
        </div>
      )}
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Комментарии</h2>

        {comments.length === 0 && <p className="text-sm text-gray-500">Пока пусто.</p>}

        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="text-sm border-l-2 pl-3">
              <div className="text-xs text-gray-500">
                {c.author?.full_name ?? "…"} · {new Date(c.created_at).toLocaleString("ru-RU")}
              </div>
              <div className="whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
        </ul>

        <form onSubmit={submitComment} className="space-y-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={3}
            className="w-full border rounded p-2 text-sm"
            placeholder="Написать комментарий…"
          />
          <button
            type="submit"
            disabled={submitting || !newComment.trim()}
            className="px-3 py-1.5 border rounded text-sm font-medium"
          >
            Отправить
          </button>
        </form>
      </div>
    </div>
  );
}
