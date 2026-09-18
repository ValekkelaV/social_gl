import { useEffect, useState } from "react";
import { Link, Routes, Route, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { useAuth } from "../auth/AuthContext";

// Контент-план: банк постов и подготовка публикаций.
//
// Ключевое отличие от «одного текста на пост»: текст живёт НЕ на посте, а на
// варианте — по одному на площадку (content_post_variants, миграция 25).
// Поэтому в карточке всегда два блока, Telegram и ВК, с разными текстами и
// разными датами публикации: в тг есть разметка ссылок и свой эмодзи-пак,
// в ВК ни того, ни другого, и выходят они не обязательно в один день.
//
// Статус при этом ОДИН на материал (idea → draft → ready → scheduled →
// published) — он про стадию работы, а не про то, куда уже ушло. Куда ушло,
// видно по published_at у вариантов.

const STATUS_LABELS = {
  idea: "Идея",
  draft: "Черновик",
  ready: "Готов",
  scheduled: "Запланирован",
  published: "Опубликован",
};

const STATUS_ORDER = ["idea", "draft", "ready", "scheduled", "published"];

const PLATFORMS = [
  { key: "telegram", label: "Telegram" },
  { key: "vk", label: "ВК" },
];

// «База постов» из ТЗ — это не отдельная сущность, а фильтр по статусу:
// идеи и черновики, без обязательной даты. Отдельной таблицы под неё нет
// намеренно (см. 03_content_plan.sql).
const BANK_STATUSES = ["idea", "draft"];

const STATUS_FILTERS = [
  { key: "bank", label: "База постов" },
  ...STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABELS[s] })),
  { key: "all", label: "Все" },
];

// datetime-local отдаёт и ждёт ЛОКАЛЬНОЕ время в формате "2026-03-01T10:00",
// а в базе лежит timestamptz. Конвертируем в обе стороны явно: если положиться
// на toISOString() при чтении, дата уедет на разницу с UTC и «10:00» превратится
// в «13:00» (или в другой день) в зависимости от часового пояса читателя.
function isoToInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputToIso(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export default function ContentPlanPage() {
  return (
    <Routes>
      <Route index element={<PostsList />} />
      <Route path=":id" element={<PostDetail />} />
    </Routes>
  );
}

// ---------------------------------------------------------------- список

function PostsList() {
  const navigate = useNavigate();
  const { person } = useAuth();

  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("bank");
  const [platformFilter, setPlatformFilter] = useState("all");

  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError("");

    supabase
      .from("content_posts")
      .select(
        `
        id, title, status, scheduled_at,
        content_post_variants(platform, scheduled_at, published_at)
      `
      )
      .order("created_at", { ascending: false })
      .then(({ data, error: fetchError }) => {
        if (!isMounted) return;
        if (fetchError) {
          console.error("Ошибка загрузки постов:", fetchError);
          setError("Не удалось загрузить посты");
        } else {
          setPosts(data ?? []);
        }
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filtered = posts.filter((p) => {
    if (statusFilter === "bank" && !BANK_STATUSES.includes(p.status)) return false;
    if (statusFilter !== "bank" && statusFilter !== "all" && p.status !== statusFilter) return false;
    if (platformFilter !== "all") {
      // Пост без варианта на площадку в фильтре по площадке не показываем:
      // он к ней ещё не отнесён.
      const variants = p.content_post_variants ?? [];
      if (!variants.some((v) => v.platform === platformFilter)) return false;
    }
    return true;
  });

  // Создание поста сразу заводит оба варианта — пустыми. Так «есть куда
  // писать» с первой секунды, и карточка не зависит от того, выбрана ли уже
  // площадка (в старом поле platform она как раз могла быть не выбрана).
  async function handleCreate(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setError("У поста должно быть рабочее название — по нему его искать в банке");
      return;
    }

    setCreating(true);
    setError("");

    const { data: created, error: insertError } = await supabase
      .from("content_posts")
      .insert({ title, status: "idea", created_by: person.id })
      .select("id")
      .single();

    if (insertError || !created) {
      console.error("Ошибка создания поста:", insertError);
      setError("Не удалось создать пост");
      setCreating(false);
      return;
    }

    const { error: variantsError } = await supabase
      .from("content_post_variants")
      .insert(PLATFORMS.map((p) => ({ post_id: created.id, platform: p.key })));

    if (variantsError) {
      console.error("Ошибка создания вариантов поста:", variantsError);
      setError("Пост создан, но площадки к нему не привязались — откройте его и сохраните заново");
    }

    setCreating(false);
    navigate(`/content-plan/${created.id}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Контент-план</h1>
      </div>

      <form onSubmit={handleCreate} className="flex gap-2 items-center">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Рабочее название нового поста"
          className="border rounded px-2 py-1.5 text-sm w-80"
        />
        <button
          type="submit"
          disabled={creating}
          className="px-3 py-1.5 border rounded text-sm font-medium disabled:text-gray-400"
        >
          {creating ? "Создаю…" : "+ Новый пост"}
        </button>
      </form>

      <div className="flex flex-wrap gap-4 items-center text-sm">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={
                statusFilter === f.key
                  ? "px-2 py-1 border rounded font-semibold"
                  : "px-2 py-1 border rounded text-gray-600"
              }
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setPlatformFilter("all")}
            className={platformFilter === "all" ? "font-semibold underline" : "text-gray-600"}
          >
            Все площадки
          </button>
          <span className="text-gray-300">|</span>
          {PLATFORMS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPlatformFilter(p.key)}
              className={platformFilter === p.key ? "font-semibold underline" : "text-gray-600"}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500">Загрузка…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <p className="text-sm text-gray-500">Постов нет.</p>
      )}

      {!loading && filtered.length > 0 && (
        <ul className="divide-y border rounded">
          {filtered.map((p) => (
            <li key={p.id}>
              <Link to={`/content-plan/${p.id}`} className="block px-4 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">{p.title || "Без названия"}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(p.content_post_variants ?? [])
                        .map((v) => {
                          const label = PLATFORMS.find((x) => x.key === v.platform)?.label ?? v.platform;
                          return v.published_at ? `${label} ✓` : label;
                        })
                        .join(" · ") || "площадки не заведены"}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-500">{STATUS_LABELS[p.status]}</div>
                    <div className="text-xs text-gray-400">
                      {p.scheduled_at ? isoToInput(p.scheduled_at).replace("T", " ") : ""}
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

// ---------------------------------------------------------------- карточка

function PostDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("idea");
  // variants — словарь по площадке: { telegram: {...}, vk: {...} }
  const [variants, setVariants] = useState({});

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError("");

    supabase
      .from("content_posts")
      .select(
        `
        id, title, status,
        content_post_variants(platform, body, scheduled_at, published_at, published_url)
      `
      )
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error: fetchError }) => {
        if (!isMounted) return;
        if (fetchError) {
          console.error("Ошибка загрузки поста:", fetchError);
          setError("Не удалось загрузить пост");
        } else if (!data) {
          setError("Пост не найден");
        } else {
          setTitle(data.title ?? "");
          setStatus(data.status);
          setVariants(
            Object.fromEntries(
              (data.content_post_variants ?? []).map((v) => [
                v.platform,
                {
                  body: v.body ?? "",
                  scheduled_at: v.scheduled_at,
                  published_at: v.published_at,
                  published_url: v.published_url ?? "",
                },
              ])
            )
          );
        }
        setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  function updateVariant(platform, field, value) {
    setSaved(false);
    setVariants((prev) => ({
      ...prev,
      [platform]: { ...(prev[platform] ?? {}), [field]: value },
    }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setError("");
    setSaved(false);

    // Пост в статусе «запланирован» обязан иметь дату: этого требует
    // check-ограничение content_posts. Своих дат у поста нет — есть даты у
    // площадок, поэтому берём самую раннюю и пишем её в поле поста.
    const dates = Object.values(variants)
      .map((v) => v.scheduled_at)
      .filter(Boolean)
      .sort();

    if (status === "scheduled" && dates.length === 0) {
      setError("Статус «Запланирован» требует даты хотя бы у одной площадки");
      return;
    }

    setSaving(true);

    const { error: postError } = await supabase
      .from("content_posts")
      .update({ title, status, scheduled_at: status === "scheduled" ? dates[0] : null })
      .eq("id", id);

    if (postError) {
      console.error("Ошибка сохранения поста:", postError);
      setError("Не удалось сохранить пост");
      setSaving(false);
      return;
    }

    const rows = PLATFORMS.map((p) => {
      const v = variants[p.key] ?? {};
      return {
        post_id: id,
        platform: p.key,
        body: v.body ?? "",
        scheduled_at: v.scheduled_at ?? null,
        published_at: v.published_at ?? null,
        published_url: (v.published_url ?? "").trim() || null,
      };
    });

    const { error: variantsError } = await supabase
      .from("content_post_variants")
      .upsert(rows, { onConflict: "post_id,platform" });

    if (variantsError) {
      console.error("Ошибка сохранения площадок:", variantsError);
      setError("Пост сохранён, а тексты по площадкам — нет. Попробуйте ещё раз");
      setSaving(false);
      return;
    }

    setSaving(false);
    setSaved(true);
  }

  if (loading) return <p className="text-sm text-gray-500">Загрузка…</p>;
  if (error && !title) return <p className="text-sm text-red-600">{error}</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate("/content-plan")} className="text-sm text-gray-600">
          ← К списку
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4">
        <div className="space-y-2 border rounded p-4">
          <div className="flex flex-wrap gap-4 items-center">
            <label className="text-sm">
              Рабочее название
              <input
                value={title}
                onChange={(e) => {
                  setSaved(false);
                  setTitle(e.target.value);
                }}
                className="ml-2 border rounded px-2 py-1 text-sm w-96"
              />
            </label>

            <label className="text-sm">
              Статус
              <select
                value={status}
                onChange={(e) => {
                  setSaved(false);
                  setStatus(e.target.value);
                }}
                className="ml-2 border rounded px-2 py-1 text-sm"
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-500">
            Статус — про стадию работы над материалом, одна на пост. Куда уже ушло, видно по
            площадкам ниже.
          </p>
        </div>

        {PLATFORMS.map((p) => {
          const v = variants[p.key] ?? {};
          return (
            <div key={p.key} className="border rounded p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">{p.label}</h2>
                {v.published_at && <span className="text-xs text-gray-500">опубликовано</span>}
              </div>

              <textarea
                value={v.body ?? ""}
                onChange={(e) => updateVariant(p.key, "body", e.target.value)}
                rows={10}
                placeholder="Текст поста для этой площадки"
                className="w-full border rounded px-2 py-1.5 text-sm font-mono"
              />

              <div className="flex flex-wrap gap-4 text-sm">
                <label>
                  Запланировать на
                  <input
                    type="datetime-local"
                    value={isoToInput(v.scheduled_at)}
                    onChange={(e) =>
                      updateVariant(p.key, "scheduled_at", inputToIso(e.target.value))
                    }
                    className="ml-2 border rounded px-2 py-1 text-sm"
                  />
                </label>

                <label>
                  Опубликовано
                  <input
                    type="datetime-local"
                    value={isoToInput(v.published_at)}
                    onChange={(e) => updateVariant(p.key, "published_at", inputToIso(e.target.value))}
                    className="ml-2 border rounded px-2 py-1 text-sm"
                  />
                </label>

                <label>
                  Ссылка на пост
                  <input
                    value={v.published_url ?? ""}
                    onChange={(e) => updateVariant(p.key, "published_url", e.target.value)}
                    placeholder="https://"
                    className="ml-2 border rounded px-2 py-1 text-sm w-72"
                  />
                </label>
              </div>
            </div>
          );
        })}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-3 py-1.5 border rounded text-sm font-medium disabled:text-gray-400"
          >
            {saving ? "Сохраняю…" : "Сохранить"}
          </button>
          {saved && <span className="text-sm text-gray-500">Сохранено</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>
    </div>
  );
}
