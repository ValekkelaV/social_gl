import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// Многополучательская адресация (несколько комитетов сразу) разрешена
// только владельцу/лиду хоть одного комитета — см. tickets_recipients_insert
// в 02_rls_policies.sql. Это UI-гейт поверх той же логики: не полагаемся
// на RLS как единственную защиту (см. обсуждение "мягкости" её insert-проверки),
// форма сама не даёт рядовому участнику выбрать больше одного получателя.

export default function CreateTicketPage() {
  const navigate = useNavigate();
  const { person, memberships, isOwner } = useAuth();

  const [committees, setCommittees] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [originCommitteeId, setOriginCommitteeId] = useState("");
  const [singleRecipientId, setSingleRecipientId] = useState("");
  const [multiRecipientIds, setMultiRecipientIds] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const canMultiRecipient = isOwner || memberships.some((m) => m.level === "lead");

  const myCommitteeOptions = useMemo(() => {
    if (isOwner) return committees;
    const ids = new Set(memberships.map((m) => m.committee_id));
    return committees.filter((c) => ids.has(c.id));
  }, [committees, memberships, isOwner]);

  useEffect(() => {
    supabase
      .from("committees")
      .select("id, name")
      .order("name")
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          console.error("Ошибка загрузки комитетов:", fetchError);
        } else {
          setCommittees(data ?? []);
        }
      });
  }, []);

  useEffect(() => {
    if (!originCommitteeId && myCommitteeOptions.length > 0) {
      setOriginCommitteeId(myCommitteeOptions[0].id);
    }
  }, [myCommitteeOptions, originCommitteeId]);

  function toggleMultiRecipient(cid) {
    setMultiRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(cid)) next.delete(cid);
      else next.add(cid);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || !originCommitteeId) return;

    setSubmitting(true);
    setError("");

    const { data: newTicket, error: insertError } = await supabase
      .from("tickets")
      .insert({
        title: title.trim(),
        description: description.trim() || null,
        origin_committee_id: originCommitteeId,
        created_by: person.id,
        source: "manual",
        status: "open",
      })
      .select("id")
      .single();

    if (insertError || !newTicket) {
      console.error("Ошибка создания тикета:", insertError);
      setError("Не удалось создать тикет");
      setSubmitting(false);
      return;
    }

    const recipientIds = canMultiRecipient
      ? Array.from(multiRecipientIds)
      : singleRecipientId
      ? [singleRecipientId]
      : [];

    if (recipientIds.length > 0) {
      const { error: recipientsError } = await supabase
        .from("ticket_recipients")
        .insert(recipientIds.map((cid) => ({ ticket_id: newTicket.id, committee_id: cid })));

      if (recipientsError) {
        console.error("Ошибка адресации тикета:", recipientsError);
        // Тикет уже создан — не блокируем переход, просто предупреждаем.
        setSubmitting(false);
        navigate(`/tickets/${newTicket.id}`);
        return;
      }
    }

    setSubmitting(false);
    navigate(`/tickets/${newTicket.id}`);
  }

  const recipientOptions = committees.filter((c) => c.id !== originCommitteeId);

  return (
    <div className="max-w-lg space-y-4">
      <Link to="/tickets" className="text-sm underline">
        ← К списку тикетов
      </Link>

      <h1 className="text-lg font-semibold">Новый тикет</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Заголовок</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full border rounded p-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Описание</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full border rounded p-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Комитет-инициатор</label>
          <select
            value={originCommitteeId}
            onChange={(e) => {
              setOriginCommitteeId(e.target.value);
              setSingleRecipientId("");
              setMultiRecipientIds(new Set());
            }}
            className="w-full border rounded p-2 text-sm"
          >
            {myCommitteeOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {canMultiRecipient ? (
          <div>
            <label className="block text-sm font-medium mb-1">
              Адресовать комитетам (можно несколько)
            </label>
            <div className="space-y-1 max-h-48 overflow-auto border rounded p-2">
              {recipientOptions.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={multiRecipientIds.has(c.id)}
                    onChange={() => toggleMultiRecipient(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">
              Адресовать другому комитету (необязательно, только один)
            </label>
            <select
              value={singleRecipientId}
              onChange={(e) => setSingleRecipientId(e.target.value)}
              className="w-full border rounded p-2 text-sm"
            >
              <option value="">— не адресовать —</option>
              {recipientOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !title.trim() || !originCommitteeId}
          className="px-4 py-2 border rounded font-medium text-sm"
        >
          Создать
        </button>
      </form>
    </div>
  );
}
