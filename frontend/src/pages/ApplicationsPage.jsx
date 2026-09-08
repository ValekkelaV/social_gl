import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

const STATUS_LABELS = {
  submitted: "Подана",
  under_review: "На рассмотрении",
  accepted: "Принята",
  rejected: "Отклонена",
  needs_revision: "На доработке",
};

const STATUS_ORDER = ["submitted", "under_review", "accepted", "rejected", "needs_revision"];

export default function ApplicationsPage() {
  return (
    <Routes>
      <Route index element={<ApplicationsList />} />
      <Route path="feedback-summary" element={<FeedbackSummary />} />
      <Route path=":id" element={<ApplicationDetail />} />
    </Routes>
  );
}

// ============================================================
// СПИСОК ЗАЯВОК
// ============================================================

function ApplicationsList() {
  const [applications, setApplications] = useState([]);
  const [readCounts, setReadCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([
      supabase
        .from("applications")
        .select("id, title, proposed_topic, desired_section, status, contact_email, created_at, speakers(full_name, sort_order)")
        .order("created_at", { ascending: false }),
      supabase.from("application_read_counts").select("application_id, reads_count"),
    ]).then(([{ data: apps, error: appsErr }, { data: reads, error: readsErr }]) => {
      if (!isMounted) return;
      if (appsErr || readsErr) {
        console.error(appsErr || readsErr);
        setError("Не удалось загрузить заявки");
      } else {
        setApplications(apps ?? []);
        const map = {};
        (reads ?? []).forEach((r) => (map[r.application_id] = r.reads_count));
        setReadCounts(map);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = applications.filter((a) => statusFilter === "all" || a.status === statusFilter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Заявки</h1>
        <Link to="/applications/feedback-summary" className="text-sm underline">
          Сводка фидбека перед рассылкой →
        </Link>
      </div>

      <div className="flex gap-2 text-sm flex-wrap">
        <button
          onClick={() => setStatusFilter("all")}
          className={statusFilter === "all" ? "px-2 py-1 border rounded font-semibold" : "px-2 py-1 border rounded text-gray-600"}
        >
          Все ({applications.length})
        </button>
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={statusFilter === s ? "px-2 py-1 border rounded font-semibold" : "px-2 py-1 border rounded text-gray-600"}
          >
            {STATUS_LABELS[s]} ({applications.filter((a) => a.status === s).length})
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-500">Загрузка…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && <p className="text-sm text-gray-500">Заявок нет.</p>}

      {!loading && !error && filtered.length > 0 && (
        <ul className="divide-y border rounded">
          {filtered.map((a) => {
            const speakerNames = (a.speakers ?? [])
              .sort((x, y) => x.sort_order - y.sort_order)
              .map((s) => s.full_name)
              .join(", ");
            const reads = readCounts[a.id] ?? 0;

            return (
              <li key={a.id}>
                <Link to={`/applications/${a.id}`} className="block px-4 py-3 hover:bg-gray-50">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <div className="font-medium">{a.title || a.proposed_topic || "Без названия"}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{speakerNames || "—"}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-gray-500">{STATUS_LABELS[a.status]}</div>
                      <div className={`text-xs mt-0.5 ${reads < 2 ? "text-amber-600" : "text-gray-400"}`}>
                        Прочитано: {reads}/2{reads < 2 ? " ⚠" : ""}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// ДЕТАЛЬ ЗАЯВКИ
// ============================================================

function ApplicationDetail() {
  const { id } = useParams();
  const { person } = useAuth();

  const [app, setApp] = useState(null);
  const [speakers, setSpeakers] = useState([]);
  const [reads, setReads] = useState([]);
  const [comments, setComments] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");

    const [
      { data: appData, error: appErr },
      { data: speakerData, error: spErr },
      { data: readData, error: readErr },
      { data: commentData, error: commentErr },
      { data: feedbackData, error: feedbackErr },
    ] = await Promise.all([
      supabase.from("applications").select("*").eq("id", id).maybeSingle(),
      supabase.from("speakers").select("*").eq("application_id", id).order("sort_order"),
      supabase.from("application_reads").select("reader_id, read_at, people(full_name)").eq("application_id", id),
      supabase
        .from("application_comments")
        .select("id, body, created_at, people(full_name)")
        .eq("application_id", id)
        .order("created_at", { ascending: true }),
      supabase.from("application_feedback").select("*").eq("application_id", id).maybeSingle(),
    ]);

    if (appErr || !appData) {
      console.error(appErr);
      setError("Заявка не найдена");
      setLoading(false);
      return;
    }

    setApp(appData);
    setSpeakers(speakerData ?? []);
    setReads(readData ?? []);
    setComments(commentData ?? []);
    setFeedback(feedbackData ?? null);
    setFeedbackDraft(feedbackData?.body ?? "");
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const alreadyRead = reads.some((r) => r.reader_id === person?.id);

  async function markAsRead() {
    setBusy(true);
    const { error: insertError } = await supabase
      .from("application_reads")
      .insert({ application_id: id, reader_id: person.id });
    if (insertError) console.error(insertError);
    await load();
    setBusy(false);
  }

  async function changeStatus(nextStatus) {
    setBusy(true);
    const { error: updateError } = await supabase.from("applications").update({ status: nextStatus }).eq("id", id);
    if (updateError) {
      console.error(updateError);
      setError("Не удалось изменить статус");
    }
    await load();
    setBusy(false);
  }

  async function submitComment(e) {
    e.preventDefault();
    if (!newComment.trim()) return;
    setBusy(true);
    const { error: insertError } = await supabase.from("application_comments").insert({
      application_id: id,
      author_id: person.id,
      body: newComment.trim(),
    });
    if (insertError) console.error(insertError);
    setNewComment("");
    await load();
    setBusy(false);
  }

  async function saveFeedback() {
    setBusy(true);
    const payload = { application_id: id, body: feedbackDraft, written_by: person.id };
    const { error: upsertError } = feedback
      ? await supabase.from("application_feedback").update(payload).eq("application_id", id)
      : await supabase.from("application_feedback").insert(payload);
    if (upsertError) console.error(upsertError);
    await load();
    setBusy(false);
  }

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;
  if (error || !app) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-red-600">{error}</p>
        <Link to="/applications" className="text-sm underline">
          ← К списку заявок
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/applications" className="text-sm underline">
        ← К списку заявок
      </Link>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">{app.title || app.proposed_topic || "Без названия"}</h1>
          <span className="text-sm text-gray-500">{STATUS_LABELS[app.status]}</span>
        </div>

        <div className="text-sm text-gray-600 space-y-1">
          <div>
            <span className="text-gray-400">Тема: </span>
            {app.proposed_topic || "—"}
          </div>
          <div>
            <span className="text-gray-400">Желаемая секция: </span>
            {app.desired_section || "—"}
          </div>
          <div>
            <span className="text-gray-400">Формат: </span>
            {app.participation_format || "—"}
          </div>
          <div>
            <span className="text-gray-400">Контакты: </span>
            {app.contact_email || "—"} {app.contact_phone ? `· ${app.contact_phone}` : ""}{" "}
            {app.contact_social ? `· ${app.contact_social}` : ""}
          </div>
          {app.external_doc_url && (
            <div>
              <a href={app.external_doc_url} target="_blank" rel="noreferrer" className="underline">
                Открыть текст заявки (внешняя ссылка) →
              </a>
            </div>
          )}
          {app.abstract_file_url && !app.external_doc_url && (
            <div>
              <a href={app.abstract_file_url} target="_blank" rel="noreferrer" className="underline">
                Файл тезисов →
              </a>
            </div>
          )}
          {app.abstract_text && (
            <details className="mt-2">
              <summary className="cursor-pointer text-gray-400">Текст тезисов (встроенный)</summary>
              <p className="whitespace-pre-wrap mt-1">{app.abstract_text}</p>
            </details>
          )}
        </div>

        <div className="text-sm">
          <span className="text-gray-400">Докладчики: </span>
          <ul className="mt-1 space-y-0.5">
            {speakers.map((s) => (
              <li key={s.id}>
                {s.full_name}
                {s.course_number ? `, курс ${s.course_number}` : ""}
                {s.education_level ? ` (${s.education_level})` : ""}
                {s.university_raw ? `, ${s.university_raw}` : ""}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Статус</h2>
        <div className="flex gap-2 flex-wrap">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              disabled={busy || app.status === s}
              onClick={() => changeStatus(s)}
              className={
                app.status === s
                  ? "px-2 py-1 border rounded text-xs font-semibold bg-gray-100"
                  : "px-2 py-1 border rounded text-xs text-gray-600"
              }
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
        {app.status === "needs_revision" && (
          <p className="text-xs text-gray-500">
            Доработка присылается по email вручную, не через форму. Занести новую версию текста —
            через историю версий (пока не реализовано в UI, добавить строку в application_text_revisions
            через SQL Editor).
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">
          Прочитано ({reads.length}/2 минимум){reads.length < 2 ? " ⚠" : " ✓"}
        </h2>
        <ul className="text-sm text-gray-600 space-y-0.5">
          {reads.map((r) => (
            <li key={r.reader_id}>
              {r.people?.full_name} · {new Date(r.read_at).toLocaleString("ru-RU")}
            </li>
          ))}
        </ul>
        {!alreadyRead && (
          <button disabled={busy} onClick={markAsRead} className="px-3 py-1.5 border rounded text-sm">
            Отметить как прочитано
          </button>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Комментарии (внутреннее обсуждение)</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li key={c.id} className="text-sm border-l-2 pl-3">
              <div className="text-xs text-gray-500">
                {c.people?.full_name} · {new Date(c.created_at).toLocaleString("ru-RU")}
              </div>
              <div className="whitespace-pre-wrap">{c.body}</div>
            </li>
          ))}
          {comments.length === 0 && <p className="text-sm text-gray-500">Пока пусто.</p>}
        </ul>
        <form onSubmit={submitComment} className="space-y-2">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            rows={2}
            className="w-full border rounded p-2 text-sm"
            placeholder="Комментарий для внутреннего обсуждения…"
          />
          <button
            type="submit"
            disabled={busy || !newComment.trim()}
            className="px-3 py-1.5 border rounded text-sm font-medium"
          >
            Отправить
          </button>
        </form>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold">
          Фидбек (финальный текст для автора)
          {feedback?.written_by && <span className="text-xs text-gray-400 font-normal"> · последний раз писал(а) кто-то из читавших</span>}
        </h2>
        <textarea
          value={feedbackDraft}
          onChange={(e) => setFeedbackDraft(e.target.value)}
          rows={5}
          className="w-full border rounded p-2 text-sm"
          placeholder="Текст, который уйдёт автору заявки…"
        />
        <button
          disabled={busy}
          onClick={saveFeedback}
          className="px-3 py-1.5 border rounded text-sm font-medium"
        >
          Сохранить фидбек
        </button>
        <p className="text-xs text-gray-400">
          Массовая отправка фидбека — на отдельном экране сводки (доступна лиду комитета
          «Отбор заявок»). Сама отправка email пока не подключена — фиксируется факт
          "готово к отправке", реальная интеграция с рассылочным сервисом будет добавлена позже.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// СВОДКА ФИДБЕКА ПЕРЕД МАССОВОЙ РАССЫЛКОЙ
// ============================================================

function FeedbackSummary() {
  const { isOwner, memberships } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState([]);
  const [sends, setSends] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const isSelectionLead = useMemo(
    () => isOwner || memberships.some((m) => m.level === "lead" && m.committees?.name === "Отбор заявок"),
    [isOwner, memberships]
  );

  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([
      supabase
        .from("applications")
        .select("id, title, proposed_topic, status, application_feedback(body, written_by)")
        .order("status"),
      supabase.from("application_feedback_sends").select("application_id, sent_at"),
    ]).then(([{ data: apps, error: appsErr }, { data: sendData, error: sendErr }]) => {
      if (!isMounted) return;
      if (appsErr || sendErr) {
        console.error(appsErr || sendErr);
        setError("Не удалось загрузить сводку");
      } else {
        setRows(apps ?? []);
        const map = {};
        (sendData ?? []).forEach((s) => (map[s.application_id] = s.sent_at));
        setSends(map);
      }
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  async function markSent(applicationId, feedbackBody) {
    setBusy(true);
    setMessage("");
    const { error: insertError } = await supabase.from("application_feedback_sends").insert({
      application_id: applicationId,
      body_snapshot: feedbackBody ?? "",
    });
    if (insertError) {
      console.error(insertError);
      setMessage("Не удалось зафиксировать отправку (только лид «Отбор заявок» может это делать)");
    } else {
      setSends((prev) => ({ ...prev, [applicationId]: new Date().toISOString() }));
    }
    setBusy(false);
  }

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;

  return (
    <div className="space-y-4 max-w-3xl">
      <button onClick={() => navigate("/applications")} className="text-sm underline">
        ← К списку заявок
      </button>

      <h1 className="text-lg font-semibold">Сводка фидбека перед рассылкой</h1>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!isSelectionLead && (
        <p className="text-sm text-amber-600">
          Отмечать письма как отправленные может только лид комитета «Отбор заявок». Вы видите
          сводку в режиме просмотра.
        </p>
      )}
      <p className="text-xs text-gray-400">
        Реальная отправка email пока не подключена (нужна интеграция с Unisender/аналогом) —
        эта кнопка только фиксирует факт "фидбек отправлен вручную/через внешний сервис".
      </p>

      <ul className="divide-y border rounded">
        {rows.map((a) => {
          const fb = a.application_feedback;
          const alreadySent = sends[a.id];
          const missingFeedback = !fb?.body?.trim();

          return (
            <li key={a.id} className="px-4 py-3 space-y-1">
              <div className="flex items-center justify-between gap-4">
                <div className="font-medium text-sm">{a.title || a.proposed_topic || "Без названия"}</div>
                <span className="text-xs text-gray-500">{STATUS_LABELS[a.status]}</span>
              </div>
              <div className={`text-sm ${missingFeedback ? "text-amber-600" : "text-gray-700"}`}>
                {missingFeedback ? "Фидбек ещё не написан ⚠" : fb.body}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {alreadySent ? `Отправлено: ${new Date(alreadySent).toLocaleString("ru-RU")}` : "Не отправлено"}
                </span>
                {isSelectionLead && !alreadySent && !missingFeedback && (
                  <button
                    disabled={busy}
                    onClick={() => markSent(a.id, fb?.body)}
                    className="text-xs px-2 py-1 border rounded"
                  >
                    Отметить отправленным
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {message && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}
